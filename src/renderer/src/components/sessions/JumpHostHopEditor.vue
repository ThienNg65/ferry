<script setup lang="ts">
import { computed, ref } from 'vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import { invoke } from '../../api'
import PasswordInput from '../shell/PasswordInput.vue'

export interface JumpHopForm {
  id: string
  sourceIndex?: number
  host: string
  port: number | string
  username: string
  authMethod: 'password' | 'privateKey'
  privateKeyPath: string
  password: string
  passphrase: string
}

const props = defineProps<{
  modelValue: JumpHopForm
  index: number
  total: number
  hasPassword?: boolean
  hasPassphrase?: boolean
  showValidation?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: JumpHopForm]
  remove: []
  'move-up': []
  'move-down': []
}>()

function set<K extends keyof JumpHopForm>(key: K, value: JumpHopForm[K]): void {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

const touched = ref({ host: false, port: false, username: false, privateKeyPath: false })

const jumpAuthOptions: { label: string; value: 'password' | 'privateKey' }[] = [
  { label: 'Password', value: 'password' },
  { label: 'Private key', value: 'privateKey' }
]

const passwordPlaceholder = computed(() => (props.hasPassword ? 'Leave blank to keep current password' : 'Password'))
const passphrasePlaceholder = computed(() =>
  props.hasPassphrase ? 'Leave blank to keep current passphrase' : 'Passphrase (optional)'
)
const hopHostError = computed(() =>
  (touched.value.host || props.showValidation) && !props.modelValue.host.trim() ? 'Host is required' : ''
)
const hopUserError = computed(() =>
  (touched.value.username || props.showValidation) && !props.modelValue.username.trim() ? 'Username is required' : ''
)
const hopKeyError = computed(() =>
  props.modelValue.authMethod === 'privateKey' &&
  (touched.value.privateKeyPath || props.showValidation) &&
  !props.modelValue.privateKeyPath.trim()
    ? 'Private key file is required'
    : ''
)
const hopPortError = computed(() => {
  if (!touched.value.port && !props.showValidation) return ''
  const port = Number(props.modelValue.port)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? '' : 'Port must be 1–65535'
})

async function browsePrivateKey(): Promise<void> {
  const path = await invoke<string | null>(INVOKE_CHANNELS.dialogPickFile)
  if (path) {
    set('privateKeyPath', path)
  }
}
</script>

<template>
  <div class="flex flex-col gap-3 rounded-md border border-default p-3">
    <div class="flex items-center justify-between gap-2">
      <div class="text-xs font-medium uppercase tracking-wide text-muted">
        Hop {{ index + 1 }} of {{ total }}
      </div>
      <div class="flex items-center gap-1">
        <UTooltip text="Move earlier">
          <UButton
            aria-label="Move earlier"
            icon="i-lucide-chevron-up"
            color="neutral"
            variant="ghost"
            size="sm"
            :disabled="index === 0"
            @click="emit('move-up')"
          />
        </UTooltip>
        <UTooltip text="Move later">
          <UButton
            aria-label="Move later"
            icon="i-lucide-chevron-down"
            color="neutral"
            variant="ghost"
            size="sm"
            :disabled="index === total - 1"
            @click="emit('move-down')"
          />
        </UTooltip>
        <UTooltip text="Remove this hop">
          <UButton aria-label="Remove this hop" icon="i-lucide-x" color="error" variant="ghost" size="sm" @click="emit('remove')" />
        </UTooltip>
      </div>
    </div>
    <div class="flex flex-col gap-3 sm:flex-row">
      <UFormField label="Host" required :error="hopHostError || undefined" class="flex-1">
        <UInput
          :model-value="modelValue.host"
          placeholder="bastion.example.com"
          class="w-full"
          @blur="touched.host = true"
          @update:model-value="(v: unknown) => set('host', String(v))"
        />
      </UFormField>
      <UFormField label="Port" required :error="hopPortError || undefined" class="w-full sm:w-28" :ui="{ error: 'text-xs leading-tight' }">
        <UInput
          :model-value="modelValue.port"
          type="number"
          min="1"
          max="65535"
          class="w-full"
          @blur="touched.port = true"
          @update:model-value="(v: unknown) => set('port', v === '' ? '' : Number(v))"
        />
      </UFormField>
    </div>
    <UFormField label="Username" required :error="hopUserError || undefined">
      <UInput
        :model-value="modelValue.username"
        class="w-full"
        @blur="touched.username = true"
        @update:model-value="(v: unknown) => set('username', String(v))"
      />
    </UFormField>
    <UFormField label="Authentication">
      <URadioGroup
        :model-value="modelValue.authMethod"
        :items="jumpAuthOptions"
        orientation="horizontal"
        :ui="{ fieldset: 'flex-wrap gap-y-1.5' }"
        @update:model-value="(v: unknown) => set('authMethod', v as 'password' | 'privateKey')"
      />
    </UFormField>
    <UFormField v-if="modelValue.authMethod === 'password'" label="Password">
      <PasswordInput
        :model-value="modelValue.password"
        label="hop password"
        :placeholder="passwordPlaceholder"
        class="w-full"
        @update:model-value="(v: string) => set('password', v)"
      />
    </UFormField>
    <template v-else>
      <UFormField label="Private key file" required :error="hopKeyError || undefined">
        <div class="flex flex-col gap-2 sm:flex-row">
          <UInput
            :model-value="modelValue.privateKeyPath"
            placeholder="Path to private key"
            class="w-full flex-1"
            @blur="touched.privateKeyPath = true"
            @update:model-value="(v: unknown) => set('privateKeyPath', String(v))"
          />
          <UButton
            color="neutral"
            variant="outline"
            :aria-label="`Browse private key file for hop ${index + 1}`"
            @click="browsePrivateKey"
          >
            Browse
          </UButton>
        </div>
      </UFormField>
      <UFormField label="Passphrase">
        <PasswordInput
          :model-value="modelValue.passphrase"
          label="hop passphrase"
          :placeholder="passphrasePlaceholder"
          class="w-full"
          @update:model-value="(v: string) => set('passphrase', v)"
        />
      </UFormField>
    </template>
  </div>
</template>
