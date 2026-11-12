<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ColorPicker from '@nuxt/ui/components/ColorPicker.vue'
import USwitch from '@nuxt/ui/components/Switch.vue'
import type { ProxyType } from '@shared/contract'
import SettingsRow from './SettingsRow.vue'
import TerminalAppearanceSettings from './TerminalAppearanceSettings.vue'
import { useSettingsStore } from '../../stores/settings.store'
import { useUpdateStore } from '../../stores/update.store'
import { useNotify } from '../../composables/useNotify'
import { useConfirm } from '../../composables/useConfirm'
import { DEFAULT_ACCENT_COLOR, useUiStore, type Density } from '../../stores/ui.store'
import { formatDateTime, formatSpeed } from '../../utils/format'
import { onTablistKeydown } from '../../utils/tablistKeys'

type TabId = 'appearance' | 'terminal' | 'network' | 'updates'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const settings = useSettingsStore()
const update = useUpdateStore()
const notify = useNotify()
const confirm = useConfirm()
const ui = useUiStore()

const tabs: { id: TabId; label: string; icon: string }[] = [
  { id: 'appearance', label: 'Appearance', icon: 'i-lucide-palette' },
  { id: 'terminal', label: 'Terminal', icon: 'i-lucide-square-terminal' },
  { id: 'network', label: 'Network', icon: 'i-lucide-network' },
  { id: 'updates', label: 'Updates & About', icon: 'i-lucide-refresh-cw' }
]
const activeTab = ref<TabId>('appearance')

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
    seedNetwork()
    await settings.fetch()
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
                    <UInput id="settings-limit" v-model.number="limitInput" type="number" :min="1" class="w-28" />
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
                    <UInput v-model.number="proxyPort" type="number" aria-label="Proxy port" class="w-24" />
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
