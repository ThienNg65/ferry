<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ColorPicker from '@nuxt/ui/components/ColorPicker.vue'
import USwitch from '@nuxt/ui/components/Switch.vue'
import { INVOKE_CHANNELS, type KnownHostEntry, type ProxyType } from '@shared/contract'
import privacyMarkdown from '../../../../../PRIVACY.md?raw'
import termsMarkdown from '../../../../../TERMS.md?raw'
import { invoke } from '../../api'
import { openExternal } from '../../bridge/neutralinoApi'
import { renderLegalMarkdown } from '../../utils/renderLegalMarkdown'
import SettingsRow from './SettingsRow.vue'
import TerminalAppearanceSettings from './TerminalAppearanceSettings.vue'
import { useSettingsStore } from '../../stores/settings.store'
import { useSitesStore } from '../../stores/sites.store'
import { useBookmarksStore } from '../../stores/bookmarks.store'
import { useHistoryStore } from '../../stores/history.store'
import { useUpdateStore } from '../../stores/update.store'
import { useNotify } from '../../composables/useNotify'
import { useConfirm } from '../../composables/useConfirm'
import { DEFAULT_ACCENT_COLOR, useUiStore, type Density } from '../../stores/ui.store'
import { formatDateTime, formatSpeed } from '../../utils/format'
import { onTablistKeydown } from '../../utils/tablistKeys'

type TabId = 'appearance' | 'terminal' | 'network' | 'privacy' | 'updates'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const settings = useSettingsStore()
const sites = useSitesStore()
const bookmarks = useBookmarksStore()
const historyStore = useHistoryStore()
const update = useUpdateStore()
const notify = useNotify()
const confirm = useConfirm()
const ui = useUiStore()

const tabs: { id: TabId; label: string; icon: string }[] = [
  { id: 'appearance', label: 'Appearance', icon: 'i-lucide-palette' },
  { id: 'terminal', label: 'Terminal', icon: 'i-lucide-square-terminal' },
  { id: 'network', label: 'Network', icon: 'i-lucide-network' },
  { id: 'privacy', label: 'Privacy & Legal', icon: 'i-lucide-shield-check' },
  { id: 'updates', label: 'Updates & About', icon: 'i-lucide-refresh-cw' }
]
const activeTab = ref<TabId>('appearance')

const knownHosts = ref<KnownHostEntry[]>([])
const legalDoc = ref<'privacy' | 'terms' | 'licenses' | null>(null)
const licensesText = ref('')
const retentionOptions = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
  { label: 'Unlimited', value: 0 }
]

const unlimited = ref(true)
const limitInput = ref(1024)
const saving = ref(false)
const checkingUpdate = ref(false)
const autoCheckUpdates = ref(true)

const proxyEnabled = ref(false)
const proxyType = ref<ProxyType>('socks5')
const proxyHost = ref('')
const proxyPort = ref(1080)
const proxyUsername = ref('')
const proxyPassword = ref('')
const snapshot = ref('')

const densityOptions: { label: string; value: Density }[] = [
  { label: 'Comfortable', value: 'comfortable' },
  { label: 'Compact', value: 'compact' }
]
const proxyTypeOptions: { label: string; value: ProxyType }[] = [
  { label: 'SOCKS5', value: 'socks5' },
  { label: 'HTTP CONNECT', value: 'http' }
]

const ACCENT_PRESETS: { label: string; hex: string }[] = [
  { label: 'Blue', hex: DEFAULT_ACCENT_COLOR },
  { label: 'Purple', hex: '#8b5cf6' },
  { label: 'Green', hex: '#22c55e' },
  { label: 'Orange', hex: '#f97316' },
  { label: 'Red', hex: '#ef4444' },
  { label: 'Teal', hex: '#14b8a6' }
]

const draftKey = computed(() =>
  JSON.stringify([
    unlimited.value,
    limitInput.value,
    proxyEnabled.value,
    proxyType.value,
    proxyHost.value,
    proxyPort.value,
    proxyUsername.value,
    proxyPassword.value
  ])
)
const dirty = computed(() => draftKey.value !== snapshot.value)

const limitError = computed(() =>
  !unlimited.value && !(Number(limitInput.value) >= 1) ? 'Enter a limit of at least 1 KB/s' : ''
)
const hostError = computed(() => (proxyEnabled.value && !proxyHost.value.trim() ? 'Host is required' : ''))
const portError = computed(() => {
  const port = Number(proxyPort.value)
  return proxyEnabled.value && !(Number.isInteger(port) && port >= 1 && port <= 65535)
    ? 'Port must be 1-65535'
    : ''
})
const invalid = computed(() => Boolean(limitError.value || hostError.value || portError.value))

function seedNetwork(): void {
  unlimited.value = settings.bandwidthLimitKBps === null
  limitInput.value = settings.bandwidthLimitKBps ?? 1024
  proxyEnabled.value = Boolean(settings.defaultProxy)
  proxyType.value = settings.defaultProxy?.type ?? 'socks5'
  proxyHost.value = settings.defaultProxy?.host ?? ''
  proxyPort.value = settings.defaultProxy?.port ?? 1080
  proxyUsername.value = settings.defaultProxy?.username ?? ''
  proxyPassword.value = ''
  snapshot.value = draftKey.value
}

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      return
    }
    activeTab.value = 'appearance'
    legalDoc.value = null
    seedNetwork()
    await settings.fetch()
    knownHosts.value = await settings.listKnownHosts()
    void update.init()
    autoCheckUpdates.value = settings.autoCheckUpdates
    seedNetwork()
  }
)

const verticalQuery = window.matchMedia('(min-width: 640px)')
const verticalTabs = ref(verticalQuery.matches)
function syncOrientation(): void {
  verticalTabs.value = verticalQuery.matches
}
verticalQuery.addEventListener('change', syncOrientation)
onBeforeUnmount(() => verticalQuery.removeEventListener('change', syncOrientation))

function formatTime(iso: string | null): string {
  return iso ? formatDateTime(iso) : 'Never'
}

async function handleCheckUpdate(): Promise<void> {
  checkingUpdate.value = true
  try {
    const res = await update.checkNow()
    if (res.status === 'not-available') {
      notify.success('Up to date', `Ferry v${update.currentVersion} is the latest version`)
    } else if (res.status === 'disabled') {
      notify.error('Updates unavailable', 'Auto-update is disabled in development mode')
    } else if (res.status === 'error' && res.error) {
      notify.error('Update check failed', res.error)
    }
  } finally {
    checkingUpdate.value = false
  }
}

async function toggleAutoCheck(value: boolean): Promise<void> {
  autoCheckUpdates.value = value
  try {
    await settings.setAutoCheckUpdates(value)
  } catch (err) {
    autoCheckUpdates.value = settings.autoCheckUpdates
    notify.error('Failed to save setting', err instanceof Error ? err.message : String(err))
  }
}

async function toggleLegalDoc(doc: 'privacy' | 'terms' | 'licenses'): Promise<void> {
  if (legalDoc.value === doc) {
    legalDoc.value = null
    return
  }
  if (doc === 'licenses' && !licensesText.value) {
    const mod = await import('../../../../../THIRD_PARTY_LICENSES.txt?raw')
    licensesText.value = mod.default
  }
  legalDoc.value = doc
}

async function onLegalLinkClick(event: MouseEvent): Promise<void> {
  const anchor = (event.target as HTMLElement | null)?.closest('a')
  if (!anchor) return
  event.preventDefault()
  if (anchor.dataset.legalDoc === 'licenses') {
    if (!licensesText.value) {
      const mod = await import('../../../../../THIRD_PARTY_LICENSES.txt?raw')
      licensesText.value = mod.default
    }
    legalDoc.value = 'licenses'
    return
  }
  const href = anchor.getAttribute('href')
  if (href) {
    void openExternal(href)
  }
}

async function onRetentionChange(value: number): Promise<void> {
  try {
    await settings.setHistoryRetentionDays(value === 0 ? null : value)
    notify.success('Retention updated', value === 0 ? 'History retention set to unlimited' : `History older than ${value} days will be removed`)
  } catch (err) {
    notify.error('Failed to update retention', err instanceof Error ? err.message : String(err))
  }
}

async function onForgetHost(hostPort: string): Promise<void> {
  try {
    await settings.forgetKnownHost(hostPort)
    knownHosts.value = knownHosts.value.filter((h) => h.hostPort !== hostPort)
  } catch (err) {
    notify.error('Failed to forget host', err instanceof Error ? err.message : String(err))
  }
}

async function onClearKnownHosts(): Promise<void> {
  const ok = await confirm({
    title: 'Clear all trusted SSH hosts?',
    body: 'You will be asked to re-verify host key fingerprints on your next connection.',
    confirmLabel: 'Clear all',
    confirmColor: 'warning'
  })
  if (!ok) return
  try {
    await settings.clearKnownHosts()
    knownHosts.value = []
  } catch (err) {
    notify.error('Failed to clear hosts', err instanceof Error ? err.message : String(err))
  }
}

async function onExportData(): Promise<void> {
  try {
    const json = await settings.exportUserData()
    const savePath = await invoke<string | null>(INVOKE_CHANNELS.dialogPickSaveFile, 'ferry-data-export.json')
    if (!savePath) return
    await invoke<void>(INVOKE_CHANNELS.fsLocalWriteFile, { path: savePath, content: json })
    notify.success('Data exported', `Saved local data export to ${savePath}`)
  } catch (err) {
    notify.error('Export failed', err instanceof Error ? err.message : String(err))
  }
}

async function onDeleteAllData(): Promise<void> {
  const ok = await confirm({
    title: 'Delete all local Ferry data?',
    body: 'This permanently erases all saved sites, encrypted credentials, bookmarks, history, trusted SSH hosts, and preferences.',
    confirmLabel: 'Delete everything',
    confirmColor: 'error'
  })
  if (!ok) return
  try {
    await settings.deleteAllLocalData()
    knownHosts.value = []
    bookmarks.reset()
    historyStore.reset()
    await sites.fetchSites()
    notify.success('Local data deleted', 'All saved local data has been erased')
    emit('update:open', false)
  } catch (err) {
    notify.error('Deletion failed', err instanceof Error ? err.message : String(err))
  }
}

async function close(): Promise<void> {
  if (dirty.value) {
    const discard = await confirm({
      title: 'Discard network changes?',
      body: 'You have unsaved bandwidth or proxy changes.',
      confirmLabel: 'Discard',
      confirmColor: 'warning'
    })
    if (!discard) {
      return
    }
  }
  emit('update:open', false)
}

async function saveNetwork(): Promise<void> {
  if (invalid.value) {
    return
  }
  saving.value = true
  try {
    await settings.setBandwidthLimitKBps(unlimited.value ? null : Math.round(Number(limitInput.value)))
    const host = proxyHost.value.trim()
    await settings.setDefaultProxy(
      proxyEnabled.value && host
        ? {
            type: proxyType.value,
            host,
            port: Number(proxyPort.value),
            username: proxyUsername.value.trim() || undefined,
            password: proxyPassword.value ? proxyPassword.value : undefined
          }
        : null
    )
    proxyPassword.value = ''
    snapshot.value = draftKey.value
    notify.success('Network settings saved', 'Your preferences have been updated')
  } catch (err) {
    notify.error('Failed to save settings', err instanceof Error ? err.message : String(err))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Settings"
    :ui="{ content: 'max-w-3xl h-[32rem] max-h-[85vh]', body: 'min-h-0 p-0 sm:p-0 overflow-hidden' }"
    @update:open="(v: boolean) => { if (!v) close() }"
  >
    <template #body>
      <div class="flex h-full flex-col sm:flex-row">
        <div
          role="tablist"
          aria-label="Settings sections"
          :aria-orientation="verticalTabs ? 'vertical' : 'horizontal'"
          class="flex shrink-0 gap-1 overflow-x-auto border-b border-muted p-2 sm:w-52 sm:flex-col sm:overflow-x-visible sm:border-b-0 sm:border-r sm:p-3"
          @keydown="onTablistKeydown($event, true, verticalTabs)"
        >
          <button
            v-for="tab in tabs"
            :id="`settings-tab-${tab.id}`"
            :key="tab.id"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.id"
            :aria-controls="`settings-panel-${tab.id}`"
            :tabindex="activeTab === tab.id ? 0 : -1"
            class="flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-primary"
            :class="activeTab === tab.id ? 'bg-primary/10 font-medium text-primary' : 'text-toned hover:bg-muted'"
            @click="activeTab = tab.id"
          >
            <UIcon :name="tab.icon" class="size-4 shrink-0" />
            {{ tab.label }}
          </button>
        </div>

        <div class="relative min-h-0 flex-1 overflow-y-auto">
          <div class="p-4 sm:p-6">
            <div
              v-show="activeTab === 'appearance'"
              id="settings-panel-appearance"
              role="tabpanel"
              aria-labelledby="settings-tab-appearance"
            >
              <h2 class="text-base font-semibold text-highlighted">Appearance</h2>
              <SettingsRow label="Accent color" description="Used for focus rings, selection and primary actions.">
                <div class="flex flex-wrap items-center gap-2">
                  <UTooltip v-for="preset in ACCENT_PRESETS" :key="preset.hex" :text="preset.label">
                    <button
                      type="button"
                      class="flex size-6 shrink-0 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-default focus-visible:outline-2 focus-visible:outline-primary"
                      :class="ui.accentColor === preset.hex ? 'ring-primary' : 'ring-transparent'"
                      :style="{ backgroundColor: preset.hex }"
                      :aria-label="preset.label"
                      :aria-pressed="ui.accentColor === preset.hex"
                      @click="ui.setAccentColor(preset.hex)"
                    >
                      <UIcon v-if="ui.accentColor === preset.hex" name="i-lucide-check" class="size-3.5 text-white" />
                    </button>
                  </UTooltip>
                  <ColorPicker
                    :model-value="ui.accentColor"
                    format="hex"
                    size="xs"
                    :throttle="100"
                    @update:model-value="(v: string | undefined) => { if (v) ui.setAccentColor(v) }"
                  />
                </div>
              </SettingsRow>
              <SettingsRow label="Row density" description="Spacing of rows in the file lists.">
                <URadioGroup
                  :model-value="ui.density"
                  :items="densityOptions"
                  orientation="horizontal"
                  @update:model-value="(v: string) => ui.setDensity(v as Density)"
                />
              </SettingsRow>
            </div>

            <div
              v-show="activeTab === 'terminal'"
              id="settings-panel-terminal"
              role="tabpanel"
              aria-labelledby="settings-tab-terminal"
            >
              <TerminalAppearanceSettings />
            </div>

            <div
              v-show="activeTab === 'network'"
              id="settings-panel-network"
              role="tabpanel"
              aria-labelledby="settings-tab-network"
            >
              <h2 class="text-base font-semibold text-highlighted">Network</h2>
              <SettingsRow label="Unlimited bandwidth" description="Turn off to cap all transfers combined.">
                <USwitch v-model="unlimited" aria-label="Unlimited bandwidth" />
              </SettingsRow>
              <SettingsRow v-if="!unlimited" label="Bandwidth limit" for-id="settings-limit">
                <div class="flex flex-col items-start gap-1 sm:items-end">
                  <div class="flex items-center gap-2">
                    <UInput
                      id="settings-limit"
                      v-model.number="limitInput"
                      type="number"
                      :min="1"
                      :aria-invalid="Boolean(limitError)"
                      class="w-28"
                    />
                    <span class="text-xs text-muted">KB/s</span>
                  </div>
                  <p v-if="limitError" class="text-xs text-error" role="alert">{{ limitError }}</p>
                </div>
              </SettingsRow>

              <SettingsRow
                label="Default proxy"
                description="Used by any site set to &quot;Use app default&quot;, for connecting through a corporate proxy with no bastion host."
              >
                <USwitch v-model="proxyEnabled" aria-label="Enable default proxy" />
              </SettingsRow>
              <template v-if="proxyEnabled">
                <SettingsRow label="Type">
                  <URadioGroup v-model="proxyType" :items="proxyTypeOptions" orientation="horizontal" />
                </SettingsRow>
                <SettingsRow label="Host and port" stacked>
                  <div class="flex gap-2">
                    <UInput v-model="proxyHost" placeholder="proxy.example.com" aria-label="Proxy host" class="w-full flex-1" />
                    <UInput
                      v-model.number="proxyPort"
                      type="number"
                      min="1"
                      max="65535"
                      aria-label="Proxy port"
                      :aria-invalid="Boolean(portError)"
                      class="w-28"
                    />
                  </div>
                  <p v-if="hostError || portError" class="mt-1 text-xs text-error" role="alert">
                    {{ hostError || portError }}
                  </p>
                </SettingsRow>
                <SettingsRow label="Credentials" description="Optional." stacked>
                  <div class="flex gap-2">
                    <UInput v-model="proxyUsername" placeholder="Username" aria-label="Proxy username" class="w-full flex-1" />
                    <UInput
                      v-model="proxyPassword"
                      type="password"
                      aria-label="Proxy password"
                      :placeholder="settings.defaultProxy?.hasPassword ? 'Leave blank to keep current' : 'Password'"
                      class="w-full flex-1"
                    />
                  </div>
                </SettingsRow>
              </template>
            </div>

            <div
              v-show="activeTab === 'privacy'"
              id="settings-panel-privacy"
              role="tabpanel"
              aria-labelledby="settings-tab-privacy"
            >
              <h2 class="text-base font-semibold text-highlighted">Privacy &amp; Legal</h2>
              <SettingsRow
                label="Maintainer & Contact"
                description="ThienNg65 · github.com/ThienNg65/ferry (MIT License). Zero telemetry, cookies, or AI training."
              >
                <span class="text-xs text-muted">
                  {{
                    settings.termsAcceptance
                      ? `Accepted v${settings.termsAcceptance.version} (${formatTime(settings.termsAcceptance.acceptedAt)})`
                      : 'Not accepted'
                  }}
                </span>
              </SettingsRow>
              <SettingsRow label="Legal & Open Source Notices" description="Review Privacy Policy, Terms of Service, and third-party licenses.">
                <div class="flex flex-wrap gap-1.5">
                  <UButton size="xs" variant="outline" color="neutral" @click="toggleLegalDoc('privacy')">
                    Privacy Policy
                  </UButton>
                  <UButton size="xs" variant="outline" color="neutral" @click="toggleLegalDoc('terms')">
                    Terms
                  </UButton>
                  <UButton size="xs" variant="outline" color="neutral" @click="toggleLegalDoc('licenses')">
                    Licenses
                  </UButton>
                </div>
              </SettingsRow>
              <div
                v-if="legalDoc === 'privacy' || legalDoc === 'terms'"
                class="ferry-legal-doc my-2 max-h-48 overflow-y-auto rounded-md border border-muted bg-elevated p-3 text-xs text-default"
                @click="onLegalLinkClick"
                v-html="renderLegalMarkdown(legalDoc === 'privacy' ? privacyMarkdown : termsMarkdown)"
              />
              <pre
                v-else-if="legalDoc === 'licenses'"
                class="my-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-muted bg-elevated p-3 font-sans text-xs text-default"
              >{{ licensesText }}</pre>

              <SettingsRow label="History retention limit" description="Automatically prune transfer & operation history older than this window.">
                <USelect
                  :model-value="settings.historyRetentionDays ?? 0"
                  :items="retentionOptions"
                  class="w-32"
                  aria-label="History retention limit"
                  @update:model-value="(v: number) => onRetentionChange(Number(v))"
                />
              </SettingsRow>

              <SettingsRow label="Data access & deletion" description="Export local data (excluding passwords) or erase all local Ferry data.">
                <div class="flex flex-wrap gap-2">
                  <UButton size="xs" variant="outline" color="neutral" icon="i-lucide-download" @click="onExportData">
                    Export My Data
                  </UButton>
                  <UButton size="xs" variant="soft" color="error" icon="i-lucide-trash-2" @click="onDeleteAllData">
                    Delete All Data
                  </UButton>
                </div>
              </SettingsRow>

              <div class="mt-4">
                <div class="mb-2 flex items-center justify-between">
                  <div>
                    <div class="text-sm font-medium text-highlighted">Trusted SSH Hosts ({{ knownHosts.length }})</div>
                    <div class="text-xs text-muted">SHA-256 host-key fingerprints stored locally in known_hosts.json.</div>
                  </div>
                  <UButton
                    v-if="knownHosts.length > 0"
                    size="xs"
                    variant="ghost"
                    color="error"
                    @click="onClearKnownHosts"
                  >
                    Clear all
                  </UButton>
                </div>
                <div v-if="knownHosts.length === 0" class="rounded-md border border-muted p-3 text-xs text-muted">
                  No trusted SSH host keys stored.
                </div>
                <div v-else class="max-h-36 divide-y divide-muted overflow-y-auto rounded-md border border-muted">
                  <div v-for="entry in knownHosts" :key="entry.hostPort" class="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                    <div class="min-w-0 flex-1">
                      <div class="truncate font-medium text-default">{{ entry.hostPort }}</div>
                      <div class="truncate font-mono text-[11px] text-muted">{{ entry.fingerprint }}</div>
                    </div>
                    <UButton size="xs" variant="ghost" color="neutral" @click="onForgetHost(entry.hostPort)">
                      Forget
                    </UButton>
                  </div>
                </div>
              </div>
            </div>

            <div
              v-show="activeTab === 'updates'"
              id="settings-panel-updates"
              role="tabpanel"
              aria-labelledby="settings-tab-updates"
            >
              <h2 class="text-base font-semibold text-highlighted">Updates & About</h2>
              <SettingsRow label="Ferry" description="Lightweight SFTP client.">
                <span class="text-sm text-toned">{{ update.currentVersion ? `v${update.currentVersion}` : '' }}</span>
              </SettingsRow>
              <SettingsRow label="Automatically check for updates">
                <USwitch
                  :model-value="autoCheckUpdates"
                  aria-label="Automatically check for updates"
                  @update:model-value="toggleAutoCheck"
                />
              </SettingsRow>

              <div v-if="update.isDownloading" class="mt-3 flex flex-col gap-1.5 rounded-md bg-muted/30 p-3 text-xs">
                <div class="flex items-center justify-between">
                  <span class="font-medium text-toned">Downloading Ferry v{{ update.availableVersion }}...</span>
                  <span class="text-muted">{{ update.progress?.percent || 0 }}% ({{ formatSpeed(update.progress?.bytesPerSecond || 0) }})</span>
                </div>
                <div class="h-1.5 w-full overflow-hidden rounded bg-muted">
                  <div
                    class="h-full bg-primary transition-all duration-300"
                    :style="{ width: `${update.progress?.percent || 0}%` }"
                  />
                </div>
              </div>

              <div
                v-else-if="update.isDownloaded"
                class="mt-3 flex items-center justify-between rounded-md border border-success/20 bg-success/10 p-3 text-xs text-success"
              >
                <span>Ferry v{{ update.availableVersion }} is ready to install</span>
                <UButton color="success" size="xs" icon="i-lucide-refresh-cw" @click="update.installNow">
                  Restart & Install
                </UButton>
              </div>

              <div class="mt-3 flex flex-wrap items-center gap-3">
                <UButton
                  size="sm"
                  variant="outline"
                  :loading="checkingUpdate || update.isChecking"
                  :disabled="!update.canCheck"
                  icon="i-lucide-refresh-cw"
                  @click="handleCheckUpdate"
                >
                  Check for updates
                </UButton>
                <span v-if="update.lastCheckedAt" class="text-xs text-muted">
                  Last checked: {{ formatTime(update.lastCheckedAt) }}
                </span>
                <span v-if="update.status === 'not-available'" class="text-xs text-muted">Latest version installed</span>
                <span v-else-if="update.status === 'disabled'" class="text-xs text-muted">Dev mode</span>
              </div>
            </div>
          </div>

          <div
            v-if="activeTab === 'network' && dirty"
            class="sticky bottom-0 flex items-center justify-end gap-2 border-t border-muted bg-default px-4 py-3 sm:px-6"
          >
            <span class="mr-auto text-xs text-muted">Unsaved changes</span>
            <UButton color="neutral" variant="outline" :disabled="saving" @click="seedNetwork">Discard</UButton>
            <UButton :loading="saving" :disabled="invalid" @click="saveNetwork">Save</UButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
