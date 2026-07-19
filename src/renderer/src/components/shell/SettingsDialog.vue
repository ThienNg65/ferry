<script setup lang="ts">
import { ref, watch } from 'vue'
import ColorPicker from '@nuxt/ui/components/ColorPicker.vue'
import type { ProxyType } from '@shared/contract'
import { useSettingsStore } from '../../stores/settings.store'
import { DEFAULT_ACCENT_COLOR, useUiStore } from '../../stores/ui.store'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const settings = useSettingsStore()
const ui = useUiStore()
const unlimited = ref(true)
const limitInput = ref(1024)
const saving = ref(false)

const proxyEnabled = ref(false)
const proxyType = ref<ProxyType>('socks5')
const proxyHost = ref('')
const proxyPort = ref(1080)
const proxyUsername = ref('')
const proxyPassword = ref('')

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

function close(): void {
  emit('update:open', false)
}

async function save(): Promise<void> {
  saving.value = true
  try {
    await settings.setBandwidthLimitKBps(unlimited.value ? null : Math.max(1, Math.round(limitInput.value)))
    await settings.setDefaultProxy(
      proxyEnabled.value && proxyHost.value.trim()
        ? {
            type: proxyType.value,
            host: proxyHost.value,
            port: proxyPort.value,
            username: proxyUsername.value || undefined,
            password: proxyPassword.value ? proxyPassword.value : undefined
          }
        : null
    )
    close()
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
      <div class="flex flex-col gap-3">
        <div class="text-sm font-medium text-highlighted">Accent color</div>
        <div class="flex items-center gap-2">
          <UTooltip v-for="preset in ACCENT_PRESETS" :key="preset.hex" :text="preset.label">
            <button
              type="button"
              class="size-6 shrink-0 rounded-full ring-2 ring-offset-2 ring-offset-default"
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
        <div class="text-sm font-medium text-highlighted">Transfer bandwidth limit</div>
        <label class="flex items-center gap-2 text-sm text-default">
          <input type="checkbox" v-model="unlimited" class="size-4" />
          Unlimited
        </label>
        <div class="flex items-center gap-2">
          <UInput
            v-model.number="limitInput"
            type="number"
            :min="1"
            :disabled="unlimited"
            class="w-32"
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
        <label class="flex items-center gap-2 text-sm text-default">
          <input type="checkbox" v-model="proxyEnabled" class="size-4" />
          Enable
        </label>
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
    </template>

    <template #footer>
      <UButton color="neutral" variant="outline" @click="close">Cancel</UButton>
      <UButton :loading="saving" @click="save">Save</UButton>
    </template>
  </UModal>
</template>
