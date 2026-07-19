<script setup lang="ts">
import { computed } from 'vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import { invoke } from '../../api'

export interface JumpHopForm {
  host: string
  port: number
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

const jumpAuthOptions: { label: string; value: 'password' | 'privateKey' }[] = [
  { label: 'Password', value: 'password' },
  { label: 'Private key', value: 'privateKey' }
]

const passwordPlaceholder = computed(() => (props.hasPassword ? 'Leave blank to keep current password' : 'Password'))
const passphrasePlaceholder = computed(() =>
  props.hasPassphrase ? 'Leave blank to keep current passphrase' : 'Passphrase (optional)'
)

async function browsePrivateKey(): Promise<void> {
  const path = await invoke<string | null>(INVOKE_CHANNELS.dialogPickFile)
  if (path) {
    set('privateKeyPath', path)
  }
}
</script>

<template>
  <div class="flex flex-col gap-3 rounded-md border border-default p-3">
    <div class="flex items-center justify-between">
      <div class="text-xs font-medium uppercase tracking-wide text-muted">
        Hop {{ index + 1 }} of {{ total }}
      </div>
      <div class="flex items-center gap-1">
        <UTooltip text="Move earlier">
          <UButton
            icon="i-lucide-chevron-up"
            color="neutral"
            variant="ghost"
            size="xs"
            :disabled="index === 0"
            @click="emit('move-up')"
          />
        </UTooltip>
        <UTooltip text="Move later">
          <UButton
            icon="i-lucide-chevron-down"
            color="neutral"
            variant="ghost"
            size="xs"
            :disabled="index === total - 1"
            @click="emit('move-down')"
          />
        </UTooltip>
        <UTooltip text="Remove this hop">
          <UButton icon="i-lucide-x" color="error" variant="ghost" size="xs" @click="emit('remove')" />
        </UTooltip>
      </div>
    </div>
    <div class="flex gap-3">
      <UFormField label="Host" class="flex-1">
        <UInput :model-value="modelValue.host" placeholder="bastion.example.com" class="w-full" @update:model-value="(v: unknown) => set('host', String(v))" />
      </UFormField>
      <UFormField label="Port" class="w-24">
        <UInput
          :model-value="modelValue.port"
          type="number"
          class="w-full"
          @update:model-value="(v: unknown) => set('port', Number(v))"
        />
      </UFormField>
    </div>
    <UFormField label="Username">
      <UInput :model-value="modelValue.username" class="w-full" @update:model-value="(v: unknown) => set('username', String(v))" />
    </UFormField>
    <UFormField label="Authentication">
      <URadioGroup
        :model-value="modelValue.authMethod"
        :items="jumpAuthOptions"
        orientation="horizontal"
        @update:model-value="(v: unknown) => set('authMethod', v as 'password' | 'privateKey')"
      />
    </UFormField>
    <UFormField v-if="modelValue.authMethod === 'password'" label="Password">
      <UInput
        :model-value="modelValue.password"
        type="password"
        :placeholder="passwordPlaceholder"
        class="w-full"
        @update:model-value="(v: unknown) => set('password', String(v))"
      />
    </UFormField>
    <template v-else>
      <UFormField label="Private key file">
        <div class="flex gap-2">
          <UInput
            :model-value="modelValue.privateKeyPath"
            placeholder="Path to private key"
            class="w-full flex-1"
            @update:model-value="(v: unknown) => set('privateKeyPath', String(v))"
          />
          <UButton color="neutral" variant="outline" @click="browsePrivateKey">Browse</UButton>
        </div>
      </UFormField>
      <UFormField label="Passphrase">
        <UInput
          :model-value="modelValue.passphrase"
          type="password"
          :placeholder="passphrasePlaceholder"
          class="w-full"
          @update:model-value="(v: unknown) => set('passphrase', String(v))"
        />
      </UFormField>
    </template>
  </div>
</template>
