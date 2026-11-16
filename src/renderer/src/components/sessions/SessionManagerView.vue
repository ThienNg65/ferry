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
import { ENVIRONMENT_DOT } from '../../utils/environment'
const SiteFormDialog = defineAsyncComponent(() => import('./SiteFormDialog.vue'))
const ImportSessionsDialog = defineAsyncComponent(() => import('./ImportSessionsDialog.vue'))
// Not yet in the auto-generated global components.d.ts — deep-import instead
// of relying on <UCheckbox> (see ImportSessionsDialog.vue for the same pattern).
import UCheckbox from '@nuxt/ui/components/Checkbox.vue'
import ContextMenu, { type ContextMenuItem } from '@nuxt/ui/components/ContextMenu.vue'

const sessions = useSessionsStore()
const sites = useSitesStore()
const settings = useSettingsStore()
const notify = useNotify()
const version = ref('')
/** Only shown when an app-wide default proxy is actually configured — otherwise this control has nothing to bypass and would just be clutter. */
const bypassDefaultProxy = ref(false)

const keyboardAnswers = ref<string[]>([])
watch(
  () => sessions.pendingKeyboardPrompt,
  (prompt) => {
    keyboardAnswers.value = prompt ? prompt.prompts.map(() => '') : []
  }
)

/** Template refs for each prompt's <UInput>, keyed by prompt index — lets Enter on a non-last
 * prompt (e.g. password before an OTP prompt) move focus forward instead of submitting early. */
const keyboardPromptInputs = ref<({ inputRef?: HTMLInputElement } | null)[]>([])

function onKeyboardPromptEnter(index: number): void {
  const promptCount = sessions.pendingKeyboardPrompt?.prompts.length ?? 0
  if (index >= promptCount - 1) {
    void submitKeyboardAnswers()
    return
  }
  keyboardPromptInputs.value[index + 1]?.inputRef?.focus()
}

async function submitKeyboardAnswers(): Promise<void> {
  await sessions.respondKeyboardInteractive([...keyboardAnswers.value])
}

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
  if (!canQuickConnect.value) return
  try {
    await sites.createSite({
      ...form,
      name: `${form.username}@${form.host}`,
      password: savePassword.value && form.authMethod === 'password' ? form.password : undefined,
      passphrase: undefined,
      privateKeyPath: form.authMethod === 'privateKey' ? form.privateKeyPath || undefined : undefined,
      proxyMode: bypassDefaultProxy.value ? 'none' : 'inherit'
    })
    notify.success('Site saved', `${form.username}@${form.host}`)
  } catch (e) {
    notify.error('Could not save site', e instanceof Error ? e.message : String(e))
  }
}

const portError = computed(() => {
  const port = Number(form.port)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? '' : 'Port must be 1–65535'
})

const canQuickConnect = computed(() => {
  return (
    form.host.trim().length > 0 &&
    form.username.trim().length > 0 &&
    portError.value === ''
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
  Boolean(activeTabQuickConnect.value && (sessions.status === 'error' || sessions.status === 'disconnected'))
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
  if (!canQuickConnect.value || sessions.connecting) return
  try {
    await sessions.connect({ ...form, proxyMode: bypassDefaultProxy.value ? 'none' : 'inherit' })
  } catch {
    // Surfaced via sessions.status/statusMessage in the template below.
  }
}

async function onConnectSite(site: Site): Promise<void> {
  try {
    await sessions.connectToSite(site)
  } catch {
    // Surfaced via sessions.status/statusMessage in the template below.
  }
}

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

async function confirmDelete(site: Site): Promise<void> {
  await confirm({
    title: 'Delete site',
    body: `Delete ${site.name}? This cannot be undone.`,
    confirmLabel: 'Delete',
    confirmColor: 'error',
    destructive: true,
    action: () => sites.deleteSite(site.id)
  })
}

const duplicatingId = ref<string | null>(null)

function siteMenuItems(site: Site): ContextMenuItem[] {
  return [
    { label: 'Duplicate', icon: 'i-lucide-copy', onSelect: () => void onDuplicate(site) },
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openEditDialog(site) },
    { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => void confirmDelete(site) }
  ]
}

async function onDuplicate(site: Site): Promise<void> {
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
  selectedIds.clear()
}

function toggleSelected(id: string, checked: boolean | 'indeterminate'): void {
  if (checked === true) {
    selectedIds.add(id)
  } else {
    selectedIds.delete(id)
  }
}

const bulkDeleteOpen = ref(false)
const bulkDeleting = ref(false)
const bulkDeleteError = ref<string | null>(null)

const selectedSites = computed(() => sites.sites.filter((s) => selectedIds.has(s.id)))

function openBulkDeleteConfirm(): void {
  if (selectedIds.size === 0) return
  bulkDeleteError.value = null
  bulkDeleteOpen.value = true
}

async function confirmBulkDelete(): Promise<void> {
  bulkDeleting.value = true
  bulkDeleteError.value = null
  try {
    await sites.deleteSites(Array.from(selectedIds))
    selectedIds.clear()
    selectMode.value = false
    bulkDeleteOpen.value = false
  } catch (e) {
    // Some deletes in the batch may have already succeeded server-side even
    // though this rejected — resync from the store's own list (below) rather
    // than trust `selectedIds`, so a retry doesn't re-attempt ones already gone.
    bulkDeleteError.value = e instanceof Error ? e.message : String(e)
  } finally {
    await sites.fetchSites()
    for (const id of Array.from(selectedIds)) {
      if (!sites.sites.some((s) => s.id === id)) {
        selectedIds.delete(id)
      }
    }
    bulkDeleting.value = false
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
      s.username.toLowerCase().includes(q)
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
  <div class="flex h-full items-start justify-center overflow-y-auto bg-default px-6 py-8">
    <div class="my-auto flex w-full max-w-4xl flex-col gap-4">
      <UCard v-if="activeTabSite || showQuickConnectBanner" class="border-primary/40 bg-primary/5">
        <div class="flex items-center justify-between gap-4">
          <div class="flex min-w-0 items-center gap-3">
            <UIcon name="i-lucide-plug-zap" class="size-5 shrink-0 text-primary" />
            <div class="min-w-0">
              <div class="truncate text-sm font-medium text-highlighted">
                {{
                  sessions.status === 'error'
                    ? 'Connection lost:'
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
          <div class="flex shrink-0 items-center gap-2">
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
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h1 class="text-base font-medium text-highlighted">Sites</h1>
              <div class="flex items-center gap-1.5">
                <UButton
                  v-if="sites.sites.length > 0"
                  :label="selectMode ? 'Cancel' : 'Select'"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  @click="toggleSelectMode"
                />
                <UTooltip text="Import from WinSCP/PuTTY">
                  <UButton
                    icon="i-lucide-import"
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    aria-label="Import sites"
                    @click="importOpen = true"
                  />
                </UTooltip>
                <UTooltip text="Import sites backup">
                  <UButton
                    icon="i-lucide-upload"
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    aria-label="Import sites backup"
                    @click="onImportSitesJson"
                  />
                </UTooltip>
                <UTooltip text="Export sites backup">
                  <UButton
                    icon="i-lucide-download"
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    aria-label="Export sites"
                    @click="onExportSites"
                  />
                </UTooltip>
                <UButton icon="i-lucide-plus" size="xs" variant="soft" @click="openCreateDialog">Add site</UButton>
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
          <div v-else-if="sites.sites.length === 0" class="flex flex-col items-center gap-2 py-6 text-center">
            <UIcon name="i-lucide-server" class="size-6 text-dimmed" />
            <p class="text-xs text-muted">No saved sites yet — add one, import from WinSCP/PuTTY, or use Quick Connect.</p>
          </div>
          <template v-else>
            <UInput
              v-model="searchQuery"
              icon="i-lucide-search"
              placeholder="Search sites by name, host, or user…"
              size="xs"
              class="mb-2.5 w-full"
            />
            <p v-if="filteredSites.length === 0" class="py-4 text-center text-xs text-muted">
              No sites match "{{ debouncedSearch }}".
            </p>
            <div
              v-if="selectMode"
              class="mb-2 flex items-center justify-between rounded-md bg-muted px-2.5 py-1.5 text-xs text-default"
            >
              <span>{{ selectedSiteIds.size }} selected</span>
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
            <div class="flex max-h-[52vh] flex-col gap-1 overflow-y-auto pr-0.5">
              <div v-for="section in groupedSites" :key="section.name ?? ''" class="flex flex-col gap-1">
                <div v-if="section.name" class="mt-2 px-2 text-2xs font-medium uppercase tracking-wide text-muted first:mt-0">
                  {{ section.name }}
                </div>
                <ul class="flex flex-col gap-1">
                  <ContextMenu v-for="site in section.sites" :key="site.id" :items="siteMenuItems(site)">
                  <li
                    class="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted"
                    :class="activeTabSite?.id === site.id ? 'bg-primary/5 ring-1 ring-primary/20' : ''"
                  >
                    <UCheckbox
                      v-if="selectMode"
                      :model-value="selectedIds.has(site.id)"
                      @update:model-value="(v: boolean | 'indeterminate') => toggleSelected(site.id, v)"
                    />
                    <UIcon v-else name="i-lucide-server" class="size-4 shrink-0 text-muted" />
                    <span
                      v-if="site.environment"
                      class="size-2 shrink-0 rounded-full"
                      :class="ENVIRONMENT_DOT[site.environment]"
                      :title="site.environment"
                    />
                    <button
                      type="button"
                      class="min-w-0 flex-1 text-left rounded-xs focus-visible:outline-2 focus-visible:outline-primary"
                      @click="selectMode ? toggleSelected(site.id, !selectedIds.has(site.id)) : onConnectSite(site)"
                    >
                      <div class="truncate text-sm font-medium text-highlighted">{{ site.name }}</div>
                      <div class="truncate text-xs text-muted">{{ site.username }}@{{ site.host }}:{{ site.port }}</div>
                    </button>
                    <UDropdownMenu v-if="!selectMode" :items="siteMenuItems(site)">
                      <UButton
                        icon="i-lucide-ellipsis"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        :aria-label="`Actions for ${site.name}`"
                        :loading="duplicatingId === site.id"
                      />
                    </UDropdownMenu>
                  </li>
                  </ContextMenu>
                </ul>
              </div>
            </div>
          </template>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <h2 class="text-base font-medium text-highlighted">Quick Connect</h2>
              <UDropdownMenu
                v-if="sessions.recentQuickConnects.length > 0"
                :items="recentQuickMenuItems"
                :content="{ onCloseAutoFocus: onRecentMenuCloseAutoFocus }"
              >
                <UButton
                  label="Recent"
                  icon="i-lucide-clock"
                  trailing-icon="i-lucide-chevron-down"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                />
              </UDropdownMenu>
            </div>
          </template>

          <form id="ferry-quick-connect-form" class="flex flex-col gap-3" @submit.prevent="onConnect">
            <div class="flex gap-3">
              <UFormField label="Host" class="flex-1">
                <UInput ref="quickHostInput" v-model="form.host" placeholder="example.com" class="w-full" />
              </UFormField>
              <UFormField label="Port" :error="portError || undefined" class="w-28" :ui="{ error: 'text-2xs leading-tight' }">
                <UInput v-model.number="form.port" type="number" min="1" max="65535" class="w-full" />
              </UFormField>
            </div>
            <UFormField label="Username">
              <UInput v-model="form.username" placeholder="e.g. root" class="w-full" />
            </UFormField>
            <UFormField label="Authentication">
              <USelect v-model="form.authMethod" :items="quickAuthOptions" class="w-full" />
            </UFormField>
            <UFormField v-if="form.authMethod === 'password'" label="Password">
              <UInput ref="quickPasswordInput" v-model="form.password" type="password" class="w-full" />
            </UFormField>
            <template v-else-if="form.authMethod === 'privateKey'">
              <UFormField label="Private key file">
                <div class="flex gap-2">
                  <UInput v-model="form.privateKeyPath" placeholder="Path to private key" class="w-full flex-1" />
                  <UButton color="neutral" variant="outline" @click="browseQuickKey">Browse</UButton>
                </div>
              </UFormField>
              <UFormField label="Passphrase">
                <UInput v-model="form.passphrase" type="password" placeholder="Optional" class="w-full" />
              </UFormField>
            </template>
            <UCheckbox
              v-if="form.authMethod === 'password' && form.password"
              v-model="savePassword"
              label="Also save the password when saving as a site"
            />

            <UCheckbox
              v-if="settings.defaultProxy"
              v-model="bypassDefaultProxy"
              label="Bypass default proxy for this connection"
            />

            <UAlert
              v-if="sessions.status === 'error' && !activeTabSite && !showQuickConnectBanner"
              color="error"
              variant="soft"
              :title="sessions.statusMessage ?? 'Connection failed'"
              :ui="{ title: 'break-words [overflow-wrap:anywhere]', description: 'break-words [overflow-wrap:anywhere]' }"
            />
          </form>

          <template #footer>
            <div class="flex gap-2">
              <UButton
                type="submit"
                form="ferry-quick-connect-form"
                class="flex-1 justify-center"
                :disabled="!canQuickConnect"
                :loading="sessions.connecting"
                @click="onConnect"
              >
                Connect
              </UButton>
              <UButton color="neutral" variant="outline" icon="i-lucide-save" :disabled="!canQuickConnect" @click="onSaveQuickAsSite">
                Save as site
              </UButton>
            </div>
          </template>
        </UCard>
      </div>

      <p v-if="version" class="text-center text-2xs text-muted">Ferry v{{ version }}</p>
    </div>

    <SiteFormDialog v-model:open="formOpen" :site="editingSite" />
    <ImportSessionsDialog v-model:open="importOpen" />

    <UModal
      :open="bulkDeleteOpen"
      title="Delete selected sites"
      :ui="{ footer: 'justify-end', content: 'max-w-lg' }"
      @update:open="(v: boolean) => { if (!v) bulkDeleteOpen = false }"
    >
      <template #body>
        <div class="flex flex-col gap-3">
          <p class="text-sm text-default">
            Delete {{ selectedSites.length === 1 ? 'this 1 site' : `these ${selectedSites.length} sites` }}? This cannot be undone.
          </p>
          <ul class="flex max-h-60 flex-col gap-1 overflow-y-auto rounded-md bg-muted p-2">
            <li v-for="site in selectedSites" :key="site.id" class="truncate text-xs text-default">
              {{ site.name }} — {{ site.username }}@{{ site.host }}:{{ site.port }}
            </li>
          </ul>
          <UAlert v-if="bulkDeleteError" color="error" variant="soft" :title="bulkDeleteError" />
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="outline" @click="bulkDeleteOpen = false">Cancel</UButton>
        <UButton color="error" :disabled="selectedSiteIds.size === 0" :loading="bulkDeleting" @click="confirmBulkDelete">
          Delete {{ selectedSites.length }}
        </UButton>
      </template>
    </UModal>

    <UModal
      :open="Boolean(sessions.pendingHostKeyMismatch)"
      title="Host key changed"
      :ui="{ footer: 'justify-end' }"
      @update:open="(v: boolean) => { if (!v) sessions.dismissHostKeyMismatch(sessions.activeTabId) }"
    >
      <template #body>
        <div class="flex flex-col gap-3">
          <UAlert
            color="warning"
            variant="soft"
            icon="i-lucide-shield-alert"
            title="This could mean a man-in-the-middle attack"
          />
          <p class="break-words [overflow-wrap:anywhere] text-sm text-default">{{ sessions.pendingHostKeyMismatch?.message }}</p>
          <p class="text-xs text-muted">
            Only continue if you're certain the change is legitimate — e.g. the server was reinstalled or its key was
            deliberately rotated.
          </p>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="outline" @click="sessions.dismissHostKeyMismatch(sessions.activeTabId)">
          Cancel
        </UButton>
        <UButton
          color="warning"
          :loading="sessions.connecting"
          @click="sessions.acceptHostKeyAndRetry(sessions.activeTabId)"
        >
          Trust new key &amp; connect
        </UButton>
      </template>
    </UModal>

    <UModal
      :open="Boolean(sessions.pendingHostKeyPrompt)"
      title="Trust this server?"
      :ui="{ footer: 'justify-end' }"
      @update:open="(v: boolean) => { if (!v) sessions.respondHostKey(false) }"
    >
      <template #body>
        <div class="flex flex-col gap-3">
          <p class="text-sm text-default">
            First connection to
            <span class="font-medium">{{ sessions.pendingHostKeyPrompt?.host }}:{{ sessions.pendingHostKeyPrompt?.port }}</span>.
            Check that this fingerprint matches the one your server administrator gave you.
          </p>
          <code class="break-all rounded-md bg-muted p-2 font-mono text-xs text-highlighted">{{ sessions.pendingHostKeyPrompt?.fingerprint }}</code>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="outline" autofocus @click="sessions.respondHostKey(false)">Cancel</UButton>
        <UButton color="primary" @click="sessions.respondHostKey(true)">Trust &amp; connect</UButton>
      </template>
    </UModal>

    <UModal
      :open="Boolean(sessions.pendingKeyboardPrompt)"
      title="Authentication required"
      :ui="{ footer: 'justify-end' }"
      @update:open="(v: boolean) => { if (!v) sessions.cancelKeyboardInteractive() }"
    >
      <template #body>
        <div class="flex flex-col gap-3">
          <p v-if="sessions.pendingKeyboardPrompt?.instructions" class="text-sm text-default">
            {{ sessions.pendingKeyboardPrompt.instructions }}
          </p>
          <UFormField
            v-for="(prompt, i) in sessions.pendingKeyboardPrompt?.prompts ?? []"
            :key="i"
            :label="prompt.prompt"
          >
            <UInput
              :ref="(el: any) => { keyboardPromptInputs[i] = el }"
              v-model="keyboardAnswers[i]"
              :type="prompt.echo ? 'text' : 'password'"
              class="w-full"
              autofocus
              @keyup.enter="onKeyboardPromptEnter(i)"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="outline" @click="sessions.cancelKeyboardInteractive">Cancel</UButton>
        <UButton @click="submitKeyboardAnswers">Submit</UButton>
      </template>
    </UModal>
    <UModal
      :open="sessions.connecting && !sessions.pendingKeyboardPrompt && !sessions.pendingHostKeyPrompt && !sessions.pendingHostKeyMismatch"
      title="Connecting..."
      prevent-close
    >
      <template #body>
        <div class="flex flex-col gap-2 max-h-60 overflow-y-auto">
          <div
            v-for="(msg, index) in sessions.activeTab?.progressMessages || []"
            :key="index"
            class="text-sm"
            :class="index === (sessions.activeTab?.progressMessages.length ?? 0) - 1 ? 'text-highlighted font-medium' : 'text-muted'"
          >
            {{ msg }}
          </div>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="outline" @click="sessions.cancelConnect(sessions.activeTabId)">Cancel</UButton>
      </template>
    </UModal>
  </div>
</template>
