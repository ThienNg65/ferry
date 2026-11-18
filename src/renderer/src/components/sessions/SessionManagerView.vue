<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { AppVersionResult, AuthMethod, QuickConnectInput, Site } from '@shared/contract'
import { invoke } from '../../api'
import { useSessionsStore, type RecentQuickConnect } from '../../stores/sessions.store'
import { useSitesStore } from '../../stores/sites.store'
import { useSettingsStore } from '../../stores/settings.store'
import { useNotify } from '../../composables/useNotify'
import { useConfirm } from '../../composables/useConfirm'
import { useDebouncedRef } from '../../composables/useDebouncedRef'
import { onTablistKeydown } from '../../utils/tablistKeys'
import { ENVIRONMENT_LABEL } from '../../utils/environment'
import PasswordInput from '../shell/PasswordInput.vue'
import SiteRow from './SiteRow.vue'
import SiteDetailsPanel from './SiteDetailsPanel.vue'
const SiteFormDialog = defineAsyncComponent(() => import('./SiteFormDialog.vue'))
const ImportSessionsDialog = defineAsyncComponent(() => import('./ImportSessionsDialog.vue'))
// Not yet in the auto-generated global components.d.ts — deep-import instead
// of relying on <UCheckbox> (see ImportSessionsDialog.vue for the same pattern).
import UCheckbox from '@nuxt/ui/components/Checkbox.vue'
import ContextMenu, { type ContextMenuItem } from '@nuxt/ui/components/ContextMenu.vue'
import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue'

const sessions = useSessionsStore()
const sites = useSitesStore()
const settings = useSettingsStore()
const notify = useNotify()
const version = ref('')
/** Only shown when an app-wide default proxy is actually configured — otherwise this control has nothing to bypass and would just be clutter. */
const bypassDefaultProxy = ref(false)
const savingQuickSite = ref(false)

onMounted(() => {
  void sites.fetchSites()
  void settings.fetch()
  void invoke<AppVersionResult>(INVOKE_CHANNELS.systemGetAppVersion).then((result) => {
    version.value = result.version
  })
})

const form = reactive<QuickConnectInput>({
  name: 'Quick Connect',
  host: '',
  port: 22,
  username: '',
  authMethod: 'password',
  password: '',
  privateKeyPath: '',
  passphrase: ''
})
const quickAuthOptions: { label: string; value: AuthMethod }[] = [
  { label: 'Password', value: 'password' },
  { label: 'Private key', value: 'privateKey' },
  { label: 'SSH agent', value: 'agent' }
]
const savePassword = ref(false)
const quickHostInput = ref<{ inputRef?: HTMLInputElement } | null>(null)
const quickPasswordInput = ref<{ inputRef?: HTMLInputElement } | null>(null)
const quickSubmitted = ref(false)
const quickTouched = reactive({ host: false, port: false, username: false, privateKeyPath: false })
let pendingFocusQuickPassword = false

const recentQuickMenuItems = computed(() =>
  sessions.recentQuickConnects.map((entry) => ({
    label: `${entry.username}@${entry.host}:${entry.port}`,
    icon: entry.authMethod === 'privateKey' ? 'i-lucide-key-round' : entry.authMethod === 'agent' ? 'i-lucide-shield-check' : 'i-lucide-terminal',
    onSelect: () => applyRecentQuickConnect(entry)
  }))
)

function applyRecentQuickConnect(entry: RecentQuickConnect): void {
  form.host = entry.host
  form.port = entry.port
  form.username = entry.username
  form.authMethod = entry.authMethod
  form.privateKeyPath = entry.privateKeyPath ?? ''
  form.password = ''
  form.passphrase = ''
  bypassDefaultProxy.value = entry.proxyMode === 'none'
  quickSubmitted.value = false
  pendingFocusQuickPassword = entry.authMethod === 'password'
}

function onRecentMenuCloseAutoFocus(event: Event): void {
  if (!pendingFocusQuickPassword) return
  pendingFocusQuickPassword = false
  event.preventDefault()
  void nextTick(() => quickPasswordInput.value?.inputRef?.focus())
}

async function browseQuickKey(): Promise<void> {
  const picked = await invoke<string | null>(INVOKE_CHANNELS.dialogPickFile)
  if (picked) {
    form.privateKeyPath = picked
  }
}

async function onSaveQuickAsSite(): Promise<void> {
  quickSubmitted.value = true
  if (!canQuickConnect.value || savingQuickSite.value) return
  savingQuickSite.value = true
  try {
    await sites.createSite({
      ...form,
      host: form.host.trim(),
      username: form.username.trim(),
      name: `${form.username.trim()}@${form.host.trim()}`,
      password: savePassword.value && form.authMethod === 'password' ? form.password : undefined,
      passphrase: undefined,
      privateKeyPath: form.authMethod === 'privateKey' ? form.privateKeyPath?.trim() || undefined : undefined,
      proxyMode: bypassDefaultProxy.value ? 'none' : 'inherit'
    })
    notify.success('Site saved', `${form.username.trim()}@${form.host.trim()}`)
  } catch (e) {
    notify.error('Could not save site', e instanceof Error ? e.message : String(e))
  } finally {
    savingQuickSite.value = false
  }
}

const isPortValid = computed(() => {
  const port = Number(form.port)
  return Number.isInteger(port) && port >= 1 && port <= 65535
})
const hostError = computed(() =>
  (quickTouched.host || quickSubmitted.value) && !form.host.trim() ? 'Host is required' : ''
)
const usernameError = computed(() =>
  (quickTouched.username || quickSubmitted.value) && !form.username.trim() ? 'Username is required' : ''
)
const privateKeyError = computed(() =>
  form.authMethod === 'privateKey' &&
  (quickTouched.privateKeyPath || quickSubmitted.value) &&
  !(form.privateKeyPath ?? '').trim()
    ? 'Private key file is required'
    : ''
)
const portError = computed(() => {
  if (!quickTouched.port && !quickSubmitted.value) return ''
  return isPortValid.value ? '' : 'Port must be 1–65535'
})

const canQuickConnect = computed(() => {
  return (
    form.host.trim().length > 0 &&
    form.username.trim().length > 0 &&
    isPortValid.value &&
    (form.authMethod !== 'privateKey' || (form.privateKeyPath ?? '').trim().length > 0)
  )
})
const canConnect = canQuickConnect

/** When the active picker tab is already bound to a saved site (restored on launch or dropped), surface a 1-click connect banner. */
const activeTabSite = computed<Site | null>(() => {
  const siteId = sessions.activeTab?.siteId
  if (!siteId) return null
  return sites.sites.find((s) => s.id === siteId) ?? null
})

const activeTabQuickConnect = computed(() => {
  if (activeTabSite.value) return null
  return sessions.activeTab?.quickConnectInput ?? null
})

const showQuickConnectBanner = computed(() =>
  Boolean(
    activeTabQuickConnect.value &&
      (sessions.status === 'disconnected' || (sessions.status === 'error' && sessions.activeTab.hadConnected))
  )
)

function prefillQuickConnect(qc: NonNullable<typeof activeTabQuickConnect.value>): void {
  form.host = qc.host
  form.port = qc.port
  form.username = qc.username
  form.authMethod = qc.authMethod
  form.privateKeyPath = qc.privateKeyPath ?? ''
  form.password = ''
  form.passphrase = ''
  bypassDefaultProxy.value = qc.proxyMode === 'none'
  void nextTick(() => {
    if (qc.authMethod === 'password') {
      quickPasswordInput.value?.inputRef?.focus()
    } else {
      quickHostInput.value?.inputRef?.focus()
    }
  })
}

function editQuickConnectFromBanner(): void {
  if (activeTabQuickConnect.value) {
    prefillQuickConnect(activeTabQuickConnect.value)
  }
}

watch(
  () => [sessions.activeTabId, sessions.status] as const,
  ([, status]) => {
    if (status === null && activeTabQuickConnect.value) {
      prefillQuickConnect(activeTabQuickConnect.value)
    }
  },
  { immediate: true }
)

async function onReconnectQuickConnect(): Promise<void> {
  try {
    await sessions.reconnectTab(sessions.activeTabId)
  } catch {
    // Surfaced via sessions.status/statusMessage in the template below.
  }
}

async function onConnect(): Promise<void> {
  quickSubmitted.value = true
  if (!canQuickConnect.value || sessions.connecting) return
  try {
    await sessions.connect({
      ...form,
      host: form.host.trim(),
      username: form.username.trim(),
      privateKeyPath: form.authMethod === 'privateKey' ? form.privateKeyPath?.trim() || undefined : undefined,
      proxyMode: bypassDefaultProxy.value ? 'none' : 'inherit'
    })
  } catch {
    // Surfaced via sessions.status/statusMessage in the template below.
  }
}

async function onConnectSite(site: Site): Promise<void> {
  if (sessions.connecting) return
  try {
    await sessions.connectToSite(site)
  } catch {
    // Surfaced via sessions.status/statusMessage in the template below.
  }
}

function siteIcon(site: Site): string {
  if (site.jumpHosts && site.jumpHosts.length > 0) return 'i-lucide-waypoints'
  if (site.authMethod === 'privateKey') return 'i-lucide-key-round'
  if (site.authMethod === 'agent') return 'i-lucide-shield-check'
  return 'i-lucide-server'
}

function isSiteOpenInTab(siteId: string): boolean {
  return sessions.tabs.some((t) => t.siteId === siteId && t.status === 'connected')
}

function isSiteConnecting(siteId: string): boolean {
  return sessions.tabs.some((t) => t.siteId === siteId && t.connecting)
}

const selectedSiteId = ref<string | null>(null)
const selectedSite = computed(() => sites.sites.find((s) => s.id === selectedSiteId.value) ?? null)

const formOpen = ref(false)
const editingSite = ref<Site | null>(null)

function openCreateDialog(): void {
  editingSite.value = null
  formOpen.value = true
}

const importOpen = ref(false)

function openEditDialog(site: Site): void {
  editingSite.value = site
  formOpen.value = true
}

const confirm = useConfirm()

function focusSiteRowOrHost(siteId: string | null): void {
  void nextTick(() => {
    const row = siteId ? document.querySelector<HTMLElement>(`[data-site-row][data-site-id="${siteId}"]`) : null
    if (row) {
      row.focus()
    } else {
      quickHostInput.value?.inputRef?.focus()
    }
  })
}

function closeSiteDetails(): void {
  const prevId = selectedSiteId.value
  selectedSiteId.value = null
  focusSiteRowOrHost(prevId)
}

function onViewEsc(): void {
  if (formOpen.value || importOpen.value || !selectedSiteId.value) return
  closeSiteDetails()
}

async function copySiteAddress(site: Site): Promise<void> {
  try {
    await navigator.clipboard.writeText(`${site.username}@${site.host}`)
    notify.success('Copied', `${site.username}@${site.host}`)
  } catch (e) {
    notify.error('Could not copy address', e instanceof Error ? e.message : String(e))
  }
}

async function disconnectSite(site: Site): Promise<void> {
  const openTabs = sessions.tabs.filter((t) => t.siteId === site.id && (t.status === 'connected' || t.connecting))
  for (const tab of openTabs) {
    await sessions.disconnectTab(tab.tabId)
  }
}

async function confirmDelete(site: Site): Promise<void> {
  const hasOpenTab = sessions.tabs.some((t) => t.siteId === site.id && (t.status === 'connected' || t.connecting))
  const deleted = await confirm({
    title: 'Delete site',
    body: hasOpenTab
      ? `Delete ${site.name}? Its active connection tab will be unlinked from this site. This cannot be undone.`
      : `Delete ${site.name}? This cannot be undone.`,
    confirmLabel: 'Delete',
    confirmColor: 'error',
    destructive: true,
    action: async () => {
      await sites.deleteSite(site.id)
      await sessions.unlinkDeletedSites([site.id])
    }
  })
  if (deleted) {
    if (selectedSiteId.value === site.id) {
      selectedSiteId.value = null
      focusSiteRowOrHost(null)
    } else if (selectedSiteId.value) {
      focusSiteRowOrHost(selectedSiteId.value)
    } else {
      void nextTick(() => {
        const firstRow = document.querySelector<HTMLElement>('[data-site-row]')
        if (firstRow) {
          firstRow.focus()
        } else {
          quickHostInput.value?.inputRef?.focus()
        }
      })
    }
  }
}

const duplicatingId = ref<string | null>(null)

function siteMenuItems(site: Site): ContextMenuItem[] {
  const connected = isSiteOpenInTab(site.id)
  const connecting = isSiteConnecting(site.id)
  const items: ContextMenuItem[] = [
    {
      label: connected || connecting ? 'Switch to tab' : 'Connect',
      icon: 'i-lucide-play',
      disabled: sessions.connecting && !connected && !connecting,
      onSelect: () => void onConnectSite(site)
    }
  ]
  if (connected || connecting) {
    items.push({
      label: 'Disconnect',
      icon: 'i-lucide-unplug',
      onSelect: () => void disconnectSite(site)
    })
  }
  items.push(
    {
      label: 'Copy user@host',
      icon: 'i-lucide-clipboard-copy',
      onSelect: () => void copySiteAddress(site)
    },
    { type: 'separator' },
    {
      label: 'Duplicate',
      icon: 'i-lucide-copy',
      disabled: duplicatingId.value === site.id,
      onSelect: () => void onDuplicate(site)
    },
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openEditDialog(site) },
    { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => void confirmDelete(site) }
  )
  return items
}

const importExportMenuItems = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: 'Import from WinSCP / PuTTY / SSH…',
      icon: 'i-lucide-import',
      onSelect: () => {
        importOpen.value = true
      }
    },
    {
      label: 'Import sites backup (.json)…',
      icon: 'i-lucide-upload',
      onSelect: () => void onImportSitesJson()
    }
  ],
  [
    {
      label: 'Export sites backup (.json)',
      icon: 'i-lucide-download',
      disabled: sites.sites.length === 0,
      onSelect: () => void onExportSites()
    }
  ]
])

async function onDuplicate(site: Site): Promise<void> {
  if (duplicatingId.value === site.id) return
  duplicatingId.value = site.id
  try {
    await sites.duplicateSite(site.id)
  } finally {
    duplicatingId.value = null
  }
}

/** Bulk-select-and-delete mode — mainly for cleaning up a batch of accidentally-duplicated imports at once. */
const selectMode = ref(false)
const selectedIds = reactive(new Set<string>())
const selectedSiteIds = selectedIds

async function onExportSites(): Promise<void> {
  if (sites.sites.length === 0) return
  try {
    const jsonStr = await invoke<string>(INVOKE_CHANNELS.sitesExport)
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ferry-sites-backup.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    notify.success('Sites exported', 'Saved to ferry-sites-backup.json')
  } catch (e) {
    notify.error('Export failed', e instanceof Error ? e.message : String(e))
  }
}

async function onImportSitesJson(): Promise<void> {
  try {
    const result = await invoke<{ imported: number; skipped: number } | null>(INVOKE_CHANNELS.sitesImportJson)
    if (!result) {
      return
    }
    await sites.fetchSites()
    notify.success('Sites imported', `${result.imported} added, ${result.skipped} already saved`)
  } catch (e) {
    notify.error('Import failed', e instanceof Error ? e.message : String(e))
  }
}

function toggleSelectMode(): void {
  selectMode.value = !selectMode.value
  selectedSiteId.value = null
  selectedIds.clear()
}

function toggleSelected(id: string, checked: boolean | 'indeterminate'): void {
  if (checked === true) {
    selectedIds.add(id)
  } else {
    selectedIds.delete(id)
  }
}

const selectedSites = computed(() => sites.sites.filter((s) => selectedIds.has(s.id)))
const allFilteredSelected = computed(
  () => filteredSites.value.length > 0 && filteredSites.value.every((s) => selectedIds.has(s.id))
)

function toggleSelectAllFiltered(): void {
  if (allFilteredSelected.value) {
    for (const s of filteredSites.value) {
      selectedIds.delete(s.id)
    }
  } else {
    for (const s of filteredSites.value) {
      selectedIds.add(s.id)
    }
  }
}

async function openBulkDeleteConfirm(): Promise<void> {
  if (selectedIds.size === 0) return
  const targets = selectedSites.value
  const hasActive = targets.some((s) =>
    sessions.tabs.some((t) => t.siteId === s.id && (t.status === 'connected' || t.connecting))
  )
  const confirmed = await confirm({
    title: 'Delete selected sites',
    body: `${
      targets.length === 1 ? 'Delete this 1 site?' : `Delete these ${targets.length} sites?`
    }${hasActive ? ' Active connections will be unlinked.' : ''} This cannot be undone.`,
    items: targets.map((s) => `${s.name} — ${s.username}@${s.host}:${s.port}`),
    confirmLabel: `Delete ${targets.length}`,
    confirmColor: 'error',
    destructive: true,
    action: async () => {
      const ids = Array.from(selectedIds)
      try {
        await sites.deleteSites(ids)
        await sessions.unlinkDeletedSites(ids)
        selectedIds.clear()
        selectMode.value = false
      } catch (e) {
        await sites.fetchSites()
        const deletedIds: string[] = []
        for (const id of Array.from(selectedIds)) {
          if (!sites.sites.some((s) => s.id === id)) {
            selectedIds.delete(id)
            deletedIds.push(id)
          }
        }
        await sessions.unlinkDeletedSites(deletedIds)
        throw e
      }
    }
  })
  if (confirmed) {
    focusSiteRowOrHost(null)
  }
}

const searchQuery = ref('')
const { debounced: debouncedSearch } = useDebouncedRef(searchQuery, 120)

const filteredSites = computed(() => {
  const q = debouncedSearch.value.trim().toLowerCase()
  if (!q) {
    return sites.sites
  }
  return sites.sites.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.host.toLowerCase().includes(q) ||
      s.username.toLowerCase().includes(q) ||
      (s.group ?? '').toLowerCase().includes(q) ||
      (s.environment ? ENVIRONMENT_LABEL[s.environment].toLowerCase().includes(q) || s.environment.toLowerCase().includes(q) : false)
  )
})

interface SiteGroupSection {
  /** Null means "no header" — used when no site has a group at all, to keep the plain flat-list look. */
  name: string | null
  sites: Site[]
}

/** Groups by `site.group`, alphabetically; ungrouped sites trail under "Ungrouped" only once some grouping is in use. */
const groupedSites = computed<SiteGroupSection[]>(() => {
  if (!filteredSites.value.some((s) => s.group)) {
    return [{ name: null, sites: filteredSites.value }]
  }
  const byGroup = new Map<string, Site[]>()
  const ungrouped: Site[] = []
  for (const site of filteredSites.value) {
    if (site.group) {
      const list = byGroup.get(site.group) ?? []
      list.push(site)
      byGroup.set(site.group, list)
    } else {
      ungrouped.push(site)
    }
  }
  const sections = Array.from(byGroup.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list]) => ({ name, sites: list }))
  if (ungrouped.length > 0) {
    sections.push({ name: 'Ungrouped', sites: ungrouped })
  }
  return sections
})
</script>

<template>
  <div class="flex h-full items-start justify-center overflow-y-auto bg-default px-4 py-6 sm:px-6 sm:py-8" @keydown.esc="onViewEsc">
    <div class="my-auto flex w-full max-w-4xl flex-col gap-4">
      <UCard v-if="activeTabSite || showQuickConnectBanner" class="border-primary/40 bg-primary/5">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex min-w-0 items-center gap-3">
            <UIcon name="i-lucide-plug-zap" class="size-5 shrink-0 text-primary" />
            <div class="min-w-0">
              <div class="truncate text-sm font-medium text-highlighted">
                {{
                  sessions.status === 'error'
                    ? sessions.activeTab.hadConnected
                      ? 'Connection lost:'
                      : 'Connection failed:'
                    : sessions.status === 'disconnected'
                      ? 'Disconnected:'
                      : 'Tab site:'
                }}
                {{ activeTabSite ? activeTabSite.name : (sessions.activeTab.label || activeTabQuickConnect?.host) }}
              </div>
              <div class="break-words [overflow-wrap:anywhere] text-xs text-muted">
                <template v-if="activeTabSite">
                  {{ activeTabSite.username }}@{{ activeTabSite.host }}:{{ activeTabSite.port }}
                </template>
                <template v-else-if="activeTabQuickConnect">
                  {{ activeTabQuickConnect.username }}@{{ activeTabQuickConnect.host }}:{{ activeTabQuickConnect.port }}
                </template>
                <span v-if="sessions.statusMessage" role="alert" class="text-error"> — {{ sessions.statusMessage }}</span>
              </div>
            </div>
          </div>
          <div class="flex shrink-0 flex-wrap items-center gap-2">
            <template v-if="activeTabSite">
              <UButton
                v-if="sessions.restoredSiteTabs.length > 1"
                icon="i-lucide-plug-zap"
                size="sm"
                color="neutral"
                variant="outline"
                :disabled="sessions.connecting"
                @click="sessions.reconnectAll()"
              >
                Reconnect all ({{ sessions.restoredSiteTabs.length }})
              </UButton>
              <UButton icon="i-lucide-play" size="sm" :loading="sessions.connecting" @click="onConnectSite(activeTabSite)">
                {{ sessions.status === 'error' || sessions.status === 'disconnected' ? 'Reconnect' : 'Connect' }}
              </UButton>
            </template>
            <template v-else>
              <UButton
                icon="i-lucide-pencil"
                size="sm"
                color="neutral"
                variant="outline"
                :disabled="sessions.connecting"
                @click="editQuickConnectFromBanner"
              >
                Edit Quick Connect
              </UButton>
              <UButton icon="i-lucide-play" size="sm" :loading="sessions.connecting" @click="onReconnectQuickConnect">
                Reconnect
              </UButton>
            </template>
          </div>
        </div>
      </UCard>

      <div class="grid grid-cols-1 gap-6 md:grid-cols-[1.2fr_1fr] md:items-start">
        <section aria-labelledby="sites-heading">
          <UCard>
            <template #header>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h1 id="sites-heading" class="text-lg font-semibold text-highlighted">Sites</h1>
                <div class="flex flex-wrap items-center gap-1.5">
                  <UButton
                    v-if="sites.sites.length > 0"
                    :label="selectMode ? 'Cancel' : 'Select'"
                    size="sm"
                    variant="ghost"
                    color="neutral"
                    @click="toggleSelectMode"
                  />
                  <UDropdownMenu :items="importExportMenuItems">
                    <UButton
                      icon="i-lucide-folder-down"
                      trailing-icon="i-lucide-chevron-down"
                      size="sm"
                      variant="ghost"
                      color="neutral"
                    >
                      <span class="sr-only sm:not-sr-only">Import / Export</span>
                    </UButton>
                  </UDropdownMenu>
                  <UButton
                    v-if="sites.sites.length > 0"
                    icon="i-lucide-plus"
                    size="sm"
                    variant="soft"
                    @click="openCreateDialog"
                  >
                    Add site
                  </UButton>
                </div>
              </div>
            </template>

            <div v-if="sites.loading" role="status" aria-label="Loading sites" class="flex flex-col gap-2 py-2">
              <div v-for="i in 4" :key="i" class="flex items-center gap-2.5 rounded-md px-2 py-1.5">
                <USkeleton class="size-4 shrink-0 rounded-xs" />
                <div class="flex flex-1 flex-col gap-1.5">
                  <USkeleton class="h-3.5 w-36" />
                  <USkeleton class="h-2.5 w-48" />
                </div>
              </div>
            </div>
            <div v-else-if="sites.error && sites.sites.length === 0" class="flex flex-col gap-3 py-2">
              <UAlert role="alert" color="error" variant="soft" title="Could not load saved sites" :description="sites.error" />
              <div class="flex justify-end">
                <UButton size="sm" variant="outline" icon="i-lucide-refresh-cw" @click="sites.fetchSites()">
                  Retry
                </UButton>
              </div>
            </div>
            <div v-else-if="sites.sites.length === 0" class="flex flex-col items-center gap-3 py-7 text-center">
              <div class="rounded-full bg-muted/60 p-3 ring-1 ring-default/15">
                <UIcon name="i-lucide-server" class="size-5 text-muted" />
              </div>
              <div class="space-y-1">
                <p class="text-sm font-medium text-default">No saved sites yet</p>
                <p class="max-w-xs text-xs text-muted">
                  Save a server for one-click access, import existing sessions from WinSCP, PuTTY, or ~/.ssh/config, or use Quick Connect.
                </p>
              </div>
              <div class="flex flex-wrap items-center justify-center gap-2 pt-0.5">
                <UButton icon="i-lucide-plus" size="sm" variant="soft" @click="openCreateDialog">Add site</UButton>
                <UButton icon="i-lucide-import" size="sm" color="neutral" variant="outline" @click="importOpen = true">
                  Import sessions
                </UButton>
              </div>
            </div>
            <template v-else>
              <UInput
                v-model="searchQuery"
                icon="i-lucide-search"
                placeholder="Search sites by name, host, user, or group…"
                aria-label="Search saved sites"
                size="sm"
                class="mb-2.5 w-full"
                :ui="{ trailing: 'pe-1' }"
                @keydown.esc.stop="searchQuery = ''"
              >
                <template v-if="searchQuery.length > 0" #trailing>
                  <UButton
                    type="button"
                    icon="i-lucide-x"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    aria-label="Clear search"
                    @click="searchQuery = ''"
                  />
                </template>
              </UInput>
              <div v-if="filteredSites.length === 0" role="status" aria-live="polite" class="flex flex-col items-center gap-2 py-4 text-center">
                <p class="text-xs text-muted">No sites match "{{ debouncedSearch }}".</p>
                <UButton size="xs" color="neutral" variant="outline" @click="searchQuery = ''">Clear search</UButton>
              </div>
              <div
                v-if="selectMode"
                class="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-2.5 py-1.5 text-xs text-default"
              >
                <div class="flex items-center gap-2">
                  <span role="status" aria-live="polite">{{ selectedSiteIds.size }} selected</span>
                  <UButton
                    v-if="filteredSites.length > 0"
                    :label="allFilteredSelected ? 'Deselect all' : 'Select all'"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    @click="toggleSelectAllFiltered"
                  />
                </div>
                <UButton
                  label="Delete selected"
                  icon="i-lucide-trash-2"
                  size="xs"
                  color="error"
                  variant="soft"
                  :disabled="selectedSiteIds.size === 0"
                  @click="openBulkDeleteConfirm"
                />
              </div>
              <div
                class="flex flex-col gap-1 pr-0.5 md:max-h-[58vh] md:overflow-y-auto"
                @keydown="onTablistKeydown($event, !selectMode, true, '[data-site-row]')"
              >
                <div v-for="section in groupedSites" :key="section.name ?? ''" class="flex flex-col gap-1">
                  <h2 v-if="section.name" class="mt-2 px-2 text-xs font-medium uppercase tracking-wide text-muted first:mt-0">
                    {{ section.name }}
                  </h2>
                  <ul class="flex flex-col gap-1">
                    <ContextMenu v-for="site in section.sites" :key="site.id" :items="siteMenuItems(site)">
                      <SiteRow
                        :site="site"
                        :icon="siteIcon(site)"
                        :selected="selectedSiteId === site.id"
                        :select-mode="selectMode"
                        :checked="selectedIds.has(site.id)"
                        :connected="isSiteOpenInTab(site.id)"
                        :connecting="isSiteConnecting(site.id)"
                        :active="activeTabSite?.id === site.id"
                        :busy="duplicatingId === site.id"
                        :menu-items="siteMenuItems(site)"
                        @select="selectedSiteId = site.id"
                        @connect="onConnectSite(site)"
                        @toggle="(v) => toggleSelected(site.id, v)"
                        @delete="confirmDelete(site)"
                      />
                    </ContextMenu>
                  </ul>
                </div>
              </div>
            </template>
          </UCard>
        </section>

        <Transition name="fade" mode="out-in">
          <section v-if="selectedSite" :key="selectedSite.id" aria-labelledby="connect-panel-heading">
            <SiteDetailsPanel
              :site="selectedSite"
              :icon="siteIcon(selectedSite)"
              :connected="isSiteOpenInTab(selectedSite.id)"
              :connecting="isSiteConnecting(selectedSite.id)"
              :busy="sessions.connecting"
              :duplicating="duplicatingId === selectedSite.id"
              @connect="onConnectSite(selectedSite)"
              @disconnect="void disconnectSite(selectedSite)"
              @edit="openEditDialog(selectedSite)"
              @duplicate="void onDuplicate(selectedSite)"
              @delete="void confirmDelete(selectedSite)"
              @close="closeSiteDetails"
            />
          </section>
          <section v-else key="quick-connect" aria-labelledby="connect-panel-heading">
            <UCard>
              <template #header>
                <div class="flex items-center justify-between gap-2">
                  <h2 id="connect-panel-heading" class="text-base font-medium text-highlighted">Quick Connect</h2>
                  <UDropdownMenu
                    v-if="sessions.recentQuickConnects.length > 0"
                    :items="recentQuickMenuItems"
                    :content="{ onCloseAutoFocus: onRecentMenuCloseAutoFocus }"
                  >
                    <UButton
                      label="Recent"
                      icon="i-lucide-clock"
                      trailing-icon="i-lucide-chevron-down"
                      size="sm"
                      color="neutral"
                      variant="ghost"
                    />
                  </UDropdownMenu>
                </div>
              </template>

              <form id="ferry-quick-connect-form" class="flex flex-col gap-3" @submit.prevent="onConnect">
                <div class="flex flex-col gap-3 sm:flex-row">
                  <UFormField label="Host" required :error="hostError || undefined" class="flex-1">
                    <UInput
                      ref="quickHostInput"
                      v-model="form.host"
                      placeholder="example.com"
                      class="w-full"
                      @blur="quickTouched.host = true"
                    />
                  </UFormField>
                  <UFormField label="Port" required :error="portError || undefined" class="w-full sm:w-28" :ui="{ error: 'text-xs leading-tight' }">
                    <UInput
                      v-model.number="form.port"
                      type="number"
                      min="1"
                      max="65535"
                      class="w-full"
                      @blur="quickTouched.port = true"
                    />
                  </UFormField>
                </div>
                <UFormField label="Username" required :error="usernameError || undefined">
                  <UInput
                    v-model="form.username"
                    placeholder="e.g. root"
                    class="w-full"
                    @blur="quickTouched.username = true"
                  />
                </UFormField>
                <UFormField label="Authentication">
                  <URadioGroup
                    v-model="form.authMethod"
                    :items="quickAuthOptions"
                    orientation="horizontal"
                    :ui="{ fieldset: 'flex-wrap gap-y-1.5' }"
                  />
                </UFormField>
                <UFormField v-if="form.authMethod === 'password'" label="Password">
                  <PasswordInput ref="quickPasswordInput" v-model="form.password" label="password" class="w-full" />
                </UFormField>
                <template v-else-if="form.authMethod === 'privateKey'">
                  <UFormField label="Private key file" required :error="privateKeyError || undefined">
                    <div class="flex flex-col gap-2 sm:flex-row">
                      <UInput
                        v-model="form.privateKeyPath"
                        placeholder="Path to private key"
                        class="w-full flex-1"
                        @blur="quickTouched.privateKeyPath = true"
                      />
                      <UButton color="neutral" variant="outline" aria-label="Browse private key file" @click="browseQuickKey">
                        Browse
                      </UButton>
                    </div>
                  </UFormField>
                  <UFormField label="Passphrase">
                    <PasswordInput v-model="form.passphrase" label="passphrase" placeholder="Optional" class="w-full" />
                  </UFormField>
                </template>
                <UCheckbox
                  v-if="form.authMethod === 'password'"
                  v-model="savePassword"
                  :disabled="!form.password"
                  label="Also save the password when saving as a site"
                />

                <UCheckbox
                  v-if="settings.defaultProxy"
                  v-model="bypassDefaultProxy"
                  label="Bypass default proxy for this connection"
                />

                <UAlert
                  v-if="sessions.status === 'error' && !activeTabSite && !showQuickConnectBanner"
                  role="alert"
                  color="error"
                  variant="soft"
                  :title="sessions.statusMessage ?? 'Connection failed'"
                  :ui="{ title: 'break-words [overflow-wrap:anywhere]', description: 'break-words [overflow-wrap:anywhere]' }"
                />
              </form>

              <template #footer>
                <div class="flex flex-wrap gap-2">
                  <UButton
                    type="submit"
                    form="ferry-quick-connect-form"
                    class="flex-1 justify-center"
                    :disabled="sessions.connecting"
                    :loading="sessions.connecting"
                  >
                    Connect
                  </UButton>
                  <UButton
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-save"
                    :loading="savingQuickSite"
                    :disabled="savingQuickSite"
                    @click="onSaveQuickAsSite"
                  >
                    Save as site
                  </UButton>
                </div>
              </template>
            </UCard>
          </section>
        </Transition>
      </div>

      <p v-if="version" class="text-center text-xs text-muted">Ferry v{{ version }}</p>
    </div>

    <SiteFormDialog
      v-model:open="formOpen"
      :site="editingSite"
      @saved-and-connect="(site) => void onConnectSite(site)"
    />
    <ImportSessionsDialog v-model:open="importOpen" />
  </div>
</template>
