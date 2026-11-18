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
import PasswordInput from './PasswordInput.vue'
import TerminalAppearanceSettings from './TerminalAppearanceSettings.vue'
import { useSettingsStore } from '../../stores/settings.store'
import { useSitesStore } from '../../stores/sites.store'
import { useBookmarksStore } from '../../stores/bookmarks.store'
import { useHistoryStore } from '../../stores/history.store'
import { useUpdateStore } from '../../stores/update.store'
import { useNotify } from '../../composables/useNotify'
import { useConfirm } from '../../composables/useConfirm'
import { DEFAULT_ACCENT_COLOR, useUiStore, type Density } from '../../stores/ui.store'
import { formatBytes, formatDateTime, formatSpeed } from '../../utils/format'
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
const autoCheckUpdates = ref(true)
const savingAutoCheck = ref(false)

const downloadPercent = computed(() => Math.min(100, Math.max(0, Math.round(update.progress?.percent ?? 0))))
const downloadDetailText = computed(() => {
  const prog = update.progress
  if (!prog) {
    return `${downloadPercent.value}%`
  }
  const speed = formatSpeed(prog.bytesPerSecond || 0)
  if (prog.total > 0) {
    return `${downloadPercent.value}% · ${formatBytes(prog.transferred)} / ${formatBytes(prog.total)} (${speed})`
  }
  return `${downloadPercent.value}% (${speed})`
})

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
const dockPositionOptions: { label: string; value: 'bottom' | 'right' }[] = [
  { label: 'Bottom', value: 'bottom' },
  { label: 'Right', value: 'right' }
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

const HEX_6_RE = /^#?[0-9a-f]{6}$/i
const HEX_3_RE = /^#?[0-9a-f]{3}$/i
const customHexInput = ref(ui.accentColor)
const hexInputInvalid = ref(false)
const colorPickerHostRef = ref<HTMLElement | null>(null)

watch(
  () => ui.accentColor,
  (val) => {
    customHexInput.value = val
    hexInputInvalid.value = false
    syncColorPickerAria()
  }
)

function normalizeHex(raw: string, allowShort = false): string | null {
  const trimmed = raw.trim()
  if (HEX_6_RE.test(trimmed)) {
    return (trimmed.startsWith('#') ? trimmed : `#${trimmed}`).toLowerCase()
  }
  if (allowShort && HEX_3_RE.test(trimmed)) {
    const clean = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed
    return `#${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`.toLowerCase()
  }
  return null
}

function onCustomHexInput(val: string): void {
  customHexInput.value = val
  const normalized = normalizeHex(val, false)
  if (normalized) {
    hexInputInvalid.value = false
    ui.setAccentColor(normalized)
  }
}

function selectAccentPreset(hex: string): void {
  ui.setAccentColor(hex)
  customHexInput.value = hex
  hexInputInvalid.value = false
}

function commitCustomHex(): void {
  const normalized = normalizeHex(customHexInput.value, true)
  if (normalized) {
    hexInputInvalid.value = false
    customHexInput.value = normalized
    ui.setAccentColor(normalized)
  } else {
    hexInputInvalid.value = true
  }
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const n = parseInt(full, 16)
  if (!Number.isFinite(n)) return { h: 210, s: 96, v: 100 }
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 }
}

function hsvToHex(h: number, s: number, v: number): string {
  const sn = Math.max(0, Math.min(100, s)) / 100
  const vn = Math.max(0, Math.min(100, v)) / 100
  const c = vn * sn
  const hue = ((h % 360) + 360) % 360
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = vn - c
  let rf = 0
  let gf = 0
  let bf = 0
  if (hue < 60) [rf, gf, bf] = [c, x, 0]
  else if (hue < 120) [rf, gf, bf] = [x, c, 0]
  else if (hue < 180) [rf, gf, bf] = [0, c, x]
  else if (hue < 240) [rf, gf, bf] = [0, x, c]
  else if (hue < 300) [rf, gf, bf] = [x, 0, c]
  else [rf, gf, bf] = [c, 0, x]
  const toHex = (val: number): string => Math.round((val + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(rf)}${toHex(gf)}${toHex(bf)}`
}

function syncColorPickerAria(): void {
  const host = colorPickerHostRef.value
  if (!host) return
  const { h, s, v } = hexToHsv(ui.accentColor)
  const selectorThumb = host.querySelector<HTMLElement>('[data-slot="selectorThumb"]')
  const trackThumb = host.querySelector<HTMLElement>('[data-slot="trackThumb"]')
  if (selectorThumb) {
    selectorThumb.setAttribute('aria-valuenow', String(Math.round(v)))
    selectorThumb.setAttribute('aria-valuetext', `Saturation ${Math.round(s)}%, Brightness ${Math.round(v)}%`)
  }
  if (trackThumb) {
    trackThumb.setAttribute('aria-valuenow', String(Math.round((h / 360) * 100)))
    trackThumb.setAttribute('aria-valuetext', `Hue ${Math.round(h)}°`)
  }
}

watch(colorPickerHostRef, (host, _, onCleanup) => {
  if (!host) return
  const selectorThumb = host.querySelector<HTMLElement>('[data-slot="selectorThumb"]')
  const trackThumb = host.querySelector<HTMLElement>('[data-slot="trackThumb"]')

  const onSelectorKeydown = (e: KeyboardEvent): void => {
    const step = e.shiftKey ? 10 : 5
    const hsv = hexToHsv(ui.accentColor)
    let handled = true
    if (e.key === 'ArrowRight') hsv.s = Math.min(100, hsv.s + step)
    else if (e.key === 'ArrowLeft') hsv.s = Math.max(0, hsv.s - step)
    else if (e.key === 'ArrowUp') hsv.v = Math.min(100, hsv.v + step)
    else if (e.key === 'ArrowDown') hsv.v = Math.max(0, hsv.v - step)
    else handled = false
    if (!handled) return
    e.preventDefault()
    ui.setAccentColor(hsvToHex(hsv.h, hsv.s, hsv.v))
  }

  const onTrackKeydown = (e: KeyboardEvent): void => {
    const step = e.shiftKey ? 10 : 5
    const hsv = hexToHsv(ui.accentColor)
    let huePct = (hsv.h / 360) * 100
    let handled = true
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') huePct = Math.min(100, huePct + step)
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') huePct = Math.max(0, huePct - step)
    else if (e.key === 'Home') huePct = 0
    else if (e.key === 'End') huePct = 100
    else handled = false
    if (!handled) return
    e.preventDefault()
    ui.setAccentColor(hsvToHex((huePct / 100) * 360, hsv.s, hsv.v))
  }

  if (selectorThumb) {
    selectorThumb.setAttribute('role', 'slider')
    selectorThumb.setAttribute('tabindex', '0')
    selectorThumb.setAttribute('aria-label', 'Color saturation and brightness')
    selectorThumb.setAttribute('aria-valuemin', '0')
    selectorThumb.setAttribute('aria-valuemax', '100')
    selectorThumb.addEventListener('keydown', onSelectorKeydown)
  }
  if (trackThumb) {
    trackThumb.setAttribute('role', 'slider')
    trackThumb.setAttribute('tabindex', '0')
    trackThumb.setAttribute('aria-label', 'Color hue')
    trackThumb.setAttribute('aria-valuemin', '0')
    trackThumb.setAttribute('aria-valuemax', '100')
    trackThumb.addEventListener('keydown', onTrackKeydown)
  }
  syncColorPickerAria()

  onCleanup(() => {
    selectorThumb?.removeEventListener('keydown', onSelectorKeydown)
    trackThumb?.removeEventListener('keydown', onTrackKeydown)
  })
})

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
    ? 'Port must be 1–65535'
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
    autoCheckUpdates.value = settings.autoCheckUpdates
    seedNetwork()
    await settings.fetch()
    knownHosts.value = await settings.listKnownHosts()
    void update.init()
    if (!savingAutoCheck.value) {
      autoCheckUpdates.value = settings.autoCheckUpdates
    }
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
  if (!update.canCheck) {
    return
  }
  const res = await update.checkNow()
  if (res.status === 'not-available') {
    notify.success(
      'Up to date',
      update.currentVersion ? `Ferry v${update.currentVersion} is the latest version` : 'You are running the latest version'
    )
  } else if (res.status === 'disabled') {
    notify.error('Updates unavailable', 'Auto-update is disabled in development mode')
  } else if (res.status === 'error' && res.error) {
    notify.error('Update check failed', res.error)
  }
}

async function toggleAutoCheck(value: boolean): Promise<void> {
  if (savingAutoCheck.value) {
    return
  }
  const previous = autoCheckUpdates.value
  autoCheckUpdates.value = value
  savingAutoCheck.value = true
  try {
    await settings.setAutoCheckUpdates(value)
  } catch (err) {
    autoCheckUpdates.value = previous
    notify.error('Failed to save setting', err instanceof Error ? err.message : String(err))
  } finally {
    savingAutoCheck.value = false
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
    :ui="{ content: 'max-w-3xl h-[35rem] max-h-[85vh]', body: 'min-h-0 p-0 sm:p-0 overflow-hidden' }"
    @update:open="(v: boolean) => { if (!v) close() }"
  >
    <template #body>
      <div class="flex h-full flex-col sm:flex-row">
        <div
          role="tablist"
          aria-label="Settings sections"
          :aria-orientation="verticalTabs ? 'vertical' : 'horizontal'"
          class="flex shrink-0 gap-1 overflow-x-auto border-b border-muted bg-muted/30 p-2 sm:w-52 sm:flex-col sm:overflow-x-visible sm:border-b-0 sm:border-r sm:p-3"
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
            class="flex items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-primary"
            :class="activeTab === tab.id ? 'bg-primary/15 font-semibold text-primary' : 'text-muted hover:bg-muted/70 hover:text-default'"
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
              <SettingsRow
                label="Modern Glass UI"
                description="Translucent frosted-glass surfaces, ambient mesh backdrop, and Plus Jakarta Sans typography."
              >
                <template #label>
                  <div class="flex items-center gap-2">
                    <span>Modern Glass UI</span>
                    <UBadge color="primary" variant="subtle" size="xs">In Development</UBadge>
                  </div>
                </template>
                <USwitch
                  :model-value="ui.glassUiEnabled"
                  aria-label="Modern Glass UI (In Development)"
                  @update:model-value="(v: boolean) => {
                    ui.setGlassUiEnabled(v)
                    ui.dismissGlassUiPromo()
                  }"
                />
              </SettingsRow>
              <SettingsRow label="Accent color" description="Used for focus rings, selection and primary actions." stacked>
                <div class="flex flex-wrap items-start justify-between gap-4">
                  <div class="flex flex-col gap-2.5">
                    <div class="flex flex-wrap items-center gap-2">
                      <UTooltip v-for="preset in ACCENT_PRESETS" :key="preset.hex" :text="preset.label">
                        <button
                          type="button"
                          class="flex size-6 shrink-0 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-default focus-visible:outline-2 focus-visible:outline-primary"
                          :class="ui.accentColor === preset.hex ? 'ring-primary' : 'ring-transparent'"
                          :style="{ backgroundColor: preset.hex }"
                          :aria-label="preset.label"
                          :aria-pressed="ui.accentColor === preset.hex"
                          @click="selectAccentPreset(preset.hex)"
                        >
                          <UIcon v-if="ui.accentColor === preset.hex" name="i-lucide-check" class="size-3.5 text-white" />
                        </button>
                      </UTooltip>
                    </div>
                    <div class="flex items-center gap-2">
                      <span
                        class="size-5 shrink-0 rounded-md border border-default"
                        :style="{ backgroundColor: ui.accentColor }"
                        aria-hidden="true"
                      />
                      <UInput
                        :model-value="customHexInput"
                        aria-label="Custom accent hex color"
                        :aria-invalid="hexInputInvalid"
                        :color="hexInputInvalid ? 'error' : undefined"
                        :highlight="hexInputInvalid"
                        placeholder="#0a84ff"
                        size="xs"
                        class="w-28 font-mono"
                        @update:model-value="(v: string) => onCustomHexInput(v)"
                        @blur="commitCustomHex"
                        @keydown.enter.prevent="commitCustomHex"
                      />
                      <span v-if="hexInputInvalid" role="alert" class="text-2xs text-error">Use #rrggbb</span>
                    </div>
                  </div>
                  <div ref="colorPickerHostRef" class="shrink-0 rounded-md border border-muted bg-muted/20 p-2">
                    <ColorPicker
                      :model-value="ui.accentColor"
                      format="hex"
                      size="xs"
                      :throttle="100"
                      :ui="{
                        selectorThumb: 'focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2',
                        trackThumb: 'focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2'
                      }"
                      @update:model-value="(v: string | undefined) => { if (v) ui.setAccentColor(v) }"
                    />
                  </div>
                </div>
              </SettingsRow>
              <SettingsRow label="Row density" description="Spacing of rows in the file lists.">
                <URadioGroup
                  :model-value="ui.density"
                  :items="densityOptions"
                  orientation="horizontal"
                  :ui="{ fieldset: 'flex-wrap gap-y-1.5' }"
                  @update:model-value="(v: string) => ui.setDensity(v as Density)"
                />
              </SettingsRow>
              <SettingsRow label="Dock position" description="Where Transfers, Log Tail, Terminal, and Monitor appear.">
                <URadioGroup
                  :model-value="ui.dockPosition"
                  :items="dockPositionOptions"
                  orientation="horizontal"
                  :ui="{ fieldset: 'flex-wrap gap-y-1.5' }"
                  @update:model-value="(v: string) => { if (v !== ui.dockPosition) ui.toggleDockPosition() }"
                />
              </SettingsRow>
              <SettingsRow
                label="Shorten location path"
                description="Collapse middle folders in the path bar into a menu."
              >
                <USwitch
                  :model-value="ui.shortenPath"
                  aria-label="Shorten location path"
                  @update:model-value="(v: boolean) => ui.setShortenPath(v)"
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
                  <URadioGroup
                    v-model="proxyType"
                    :items="proxyTypeOptions"
                    orientation="horizontal"
                    :ui="{ fieldset: 'flex-wrap gap-y-1.5' }"
                  />
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
                    <PasswordInput
                      v-model="proxyPassword"
                      label="proxy password"
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
                      <div class="truncate font-mono text-2xs text-muted">{{ entry.fingerprint }}</div>
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
                  :disabled="savingAutoCheck"
                  aria-label="Automatically check for updates"
                  @update:model-value="toggleAutoCheck"
                />
              </SettingsRow>

              <div v-if="update.isAvailable" class="mt-3 flex items-center gap-2 rounded-md bg-muted/30 p-3 text-xs text-toned">
                <UIcon name="i-lucide-download" class="size-4 shrink-0 text-primary" />
                <span>
                  {{ update.availableVersion ? `Ferry v${update.availableVersion}` : 'A new update' }} is available — starting download…
                </span>
              </div>

              <div v-else-if="update.isDownloading" class="mt-3 flex flex-col gap-1.5 rounded-md bg-muted/30 p-3 text-xs">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="font-medium text-toned">
                    Downloading {{ update.availableVersion ? `Ferry v${update.availableVersion}` : 'update' }}...
                  </span>
                  <span class="text-muted">{{ downloadDetailText }}</span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Update download progress"
                  :aria-valuenow="downloadPercent"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  :aria-valuetext="`${downloadPercent}%`"
                  class="h-1.5 w-full overflow-hidden rounded bg-muted"
                >
                  <div
                    class="h-full bg-primary transition-all duration-300"
                    :style="{ width: `${downloadPercent}%` }"
                  />
                </div>
              </div>

              <div
                v-else-if="update.isDownloaded"
                class="mt-3 flex items-center justify-between gap-3 rounded-md border border-success/20 bg-success/10 p-3 text-xs text-success"
              >
                <span>{{ update.availableVersion ? `Ferry v${update.availableVersion}` : 'Update' }} is ready to install</span>
                <UButton
                  color="success"
                  size="xs"
                  icon="i-lucide-refresh-cw"
                  :loading="update.installing"
                  :disabled="update.installing"
                  @click="update.installNow()"
                >
                  Restart & Install
                </UButton>
              </div>

              <div
                v-else-if="update.status === 'error'"
                role="alert"
                class="mt-3 flex items-center justify-between gap-3 rounded-md border border-error/20 bg-error/10 p-3 text-xs text-error"
              >
                <div class="min-w-0 flex-1">
                  <div class="font-medium">Update failed</div>
                  <div class="mt-0.5 break-words text-error/90">{{ update.error || 'Could not check for or download updates.' }}</div>
                </div>
                <UButton
                  color="error"
                  variant="soft"
                  size="xs"
                  icon="i-lucide-refresh-cw"
                  :disabled="!update.canCheck"
                  @click="handleCheckUpdate"
                >
                  Retry
                </UButton>
              </div>

              <div class="mt-3 flex flex-wrap items-center gap-3">
                <UButton
                  size="sm"
                  variant="outline"
                  :loading="update.isChecking"
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
