<script setup lang="ts">
import { ref, watch } from 'vue'
import ColorPicker from '@nuxt/ui/components/ColorPicker.vue'
import UCheckbox from '@nuxt/ui/components/Checkbox.vue'
import type { ProxyType } from '@shared/contract'
import { useSettingsStore } from '../../stores/settings.store'
import { useUpdateStore } from '../../stores/update.store'
import { useNotify } from '../../composables/useNotify'
import { DEFAULT_ACCENT_COLOR, useUiStore, type Density } from '../../stores/ui.store'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const settings = useSettingsStore()
const update = useUpdateStore()
const notify = useNotify()
const ui = useUiStore()
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

const densityOptions: { label: string; value: Density }[] = [
  { label: 'Comfortable', value: 'comfortable' },
  { label: 'Compact', value: 'compact' }
]
const proxyTypeOptions: { label: string; value: ProxyType }[] = [
  { label: 'SOCKS5', value: 'socks5' },
  { label: 'HTTP CONNECT', value: 'http' }
]

/** Curated presets, chosen for reasonable contrast/saturation — a naive arbitrary custom pick can otherwise wash out focus rings and selected-row highlighting. */
const ACCENT_PRESETS: { label: string; hex: string }[] = [
  { label: 'Blue', hex: DEFAULT_ACCENT_COLOR },
  { label: 'Purple', hex: '#8b5cf6' },
  { label: 'Green', hex: '#22c55e' },
  { label: 'Orange', hex: '#f97316' },
  { label: 'Red', hex: '#ef4444' },
  { label: 'Teal', hex: '#14b8a6' }
]

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      return
    }
    await settings.fetch()
    void update.init()
    autoCheckUpdates.value = settings.autoCheckUpdates
    unlimited.value = settings.bandwidthLimitKBps === null
    limitInput.value = settings.bandwidthLimitKBps ?? 1024
    proxyEnabled.value = Boolean(settings.defaultProxy)
    proxyType.value = settings.defaultProxy?.type ?? 'socks5'
    proxyHost.value = settings.defaultProxy?.host ?? ''
    proxyPort.value = settings.defaultProxy?.port ?? 1080
    proxyUsername.value = settings.defaultProxy?.username ?? ''
    proxyPassword.value = ''
  }
)

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
  }
  return `${Math.round(bytesPerSec / 1024)} KB/s`
}

function formatTime(iso: string | null): string {
  if (!iso) return 'Never'
  try {
    const date = new Date(iso)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
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

function close(): void {
  emit('update:open', false)
}

async function save(): Promise<void> {
  saving.value = true
  try {
    const rawLimit = Number(limitInput.value)
    const sanitizedLimit =
      unlimited.value || !Number.isFinite(rawLimit) || rawLimit <= 0
        ? null
        : Math.max(1, Math.round(rawLimit))

    await settings.setAutoCheckUpdates(autoCheckUpdates.value)
    await settings.setBandwidthLimitKBps(sanitizedLimit)
    const host = proxyHost.value.trim()
    const port = Number(proxyPort.value) || 1080
    await settings.setDefaultProxy(
      proxyEnabled.value && host
        ? {
            type: proxyType.value,
            host,
            port: port >= 1 && port <= 65535 ? port : 1080,
            username: proxyUsername.value.trim() || undefined,
            password: proxyPassword.value ? proxyPassword.value : undefined
          }
        : null
    )
    notify.success('Settings saved', 'Your preferences have been updated')
    close()
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
    :ui="{ footer: 'justify-end', content: 'max-w-md' }"
    @update:open="(v: boolean) => { if (!v) close() }"
  >
    <template #body>
      <div class="flex flex-col gap-3 max-h-[70vh] overflow-y-auto pr-1">
        <div class="text-sm font-medium text-highlighted">Accent color</div>
        <div class="flex items-center gap-2">
          <UTooltip v-for="preset in ACCENT_PRESETS" :key="preset.hex" :text="preset.label">
            <button
              type="button"
              class="size-6 shrink-0 rounded-full ring-2 ring-offset-2 ring-offset-default focus-visible:outline-2 focus-visible:outline-primary"
              :class="ui.accentColor === preset.hex ? 'ring-primary' : 'ring-transparent'"
              :style="{ backgroundColor: preset.hex }"
              :aria-label="preset.label"
              @click="ui.setAccentColor(preset.hex)"
            />
          </UTooltip>
          <ColorPicker
            :model-value="ui.accentColor"
            format="hex"
            size="xs"
            :throttle="100"
            @update:model-value="(v: string | undefined) => { if (v) ui.setAccentColor(v) }"
          />
        </div>
      </div>
      <div class="mt-4 flex flex-col gap-3">
        <div class="text-sm font-medium text-highlighted">Row density</div>
        <URadioGroup
          :model-value="ui.density"
          :items="densityOptions"
          orientation="horizontal"
          @update:model-value="(v: string) => ui.setDensity(v as Density)"
        />
      </div>
      <div class="mt-4 flex flex-col gap-3">
        <div class="text-sm font-medium text-highlighted">Transfer bandwidth limit</div>
        <UCheckbox v-model="unlimited" label="Unlimited" />
        <div class="flex items-center gap-2">
          <UInput
            v-model.number="limitInput"
            type="number"
            :min="1"
            :disabled="unlimited"
            class="w-32 transition-opacity"
            :class="unlimited ? 'opacity-50 cursor-not-allowed' : ''"
          />
          <span class="text-xs text-muted">KB/s, applies to all transfers combined</span>
        </div>
      </div>
      <div class="mt-4 flex flex-col gap-3">
        <div>
          <div class="text-sm font-medium text-highlighted">Default proxy</div>
          <div class="text-xs text-muted">
            Used by any site set to "Use app default" — for connecting through a corporate proxy with no bastion host.
          </div>
        </div>
        <UCheckbox v-model="proxyEnabled" label="Enable" />
        <template v-if="proxyEnabled">
          <URadioGroup v-model="proxyType" :items="proxyTypeOptions" orientation="horizontal" />
          <div class="flex gap-2">
            <UInput v-model="proxyHost" placeholder="proxy.example.com" class="w-full flex-1" />
            <UInput v-model.number="proxyPort" type="number" class="w-24" />
          </div>
          <div class="flex gap-2">
            <UInput v-model="proxyUsername" placeholder="Username (optional)" class="w-full flex-1" />
            <UInput
              v-model="proxyPassword"
              type="password"
              :placeholder="settings.defaultProxy?.hasPassword ? 'Leave blank to keep current password' : 'Password (optional)'"
              class="w-full flex-1"
            />
          </div>
        </template>
      </div>

      <div class="mt-4 flex flex-col gap-3 border-t border-muted pt-4">
        <div class="flex items-center justify-between">
          <div class="text-sm font-medium text-highlighted">Updates & About</div>
          <span class="text-xs text-muted">v{{ update.currentVersion || '0.14.11' }}</span>
        </div>
        <UCheckbox v-model="autoCheckUpdates" label="Automatically check for updates" />

        <div v-if="update.isDownloading" class="flex flex-col gap-1.5 rounded bg-muted/30 p-2.5 text-xs">
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

        <div v-else-if="update.isDownloaded" class="flex items-center justify-between rounded border border-green-500/20 bg-green-500/10 p-2.5 text-xs text-green-400">
          <span>Ferry v{{ update.availableVersion }} is ready to install</span>
          <UButton color="success" size="xs" icon="i-lucide-refresh-cw" @click="update.installNow">
            Restart & Install
          </UButton>
        </div>

        <div class="flex items-center justify-between pt-1">
          <div class="flex items-center gap-2">
            <UButton
              size="xs"
              variant="outline"
              :loading="checkingUpdate || update.isChecking"
              :disabled="!update.canCheck"
              icon="i-lucide-refresh-cw"
              @click="handleCheckUpdate"
            >
              Check for updates
            </UButton>
            <span v-if="update.lastCheckedAt" class="text-[11px] text-muted">
              Last checked: {{ formatTime(update.lastCheckedAt) }}
            </span>
          </div>
          <span v-if="update.status === 'not-available'" class="text-[11px] text-muted">
            Latest version installed
          </span>
          <span v-else-if="update.status === 'disabled'" class="text-[11px] text-muted">
            Dev mode
          </span>
        </div>
      </div>
    </template>

    <template #footer>
      <UButton color="neutral" variant="outline" @click="close">Cancel</UButton>
      <UButton :loading="saving" @click="save">Save</UButton>
    </template>
  </UModal>
</template>
