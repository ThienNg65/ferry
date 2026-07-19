<script setup lang="ts">
import { ref, watch } from 'vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { KeyGenerateResult } from '@shared/contract'
import { invoke } from '../../api'
import { useNotify } from '../../composables/useNotify'

const props = defineProps<{
  open: boolean
  /** Used only to seed the suggested filename, e.g. the site name being configured. */
  suggestedName?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  generated: [result: KeyGenerateResult]
}>()

const notify = useNotify()
const keyPath = ref('')
const passphrase = ref('')
const generating = ref(false)
const error = ref<string | null>(null)
const result = ref<KeyGenerateResult | null>(null)

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'site'
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      keyPath.value = `id_ed25519_${slugify(props.suggestedName ?? '')}`
      passphrase.value = ''
      error.value = null
      result.value = null
    }
  }
)

async function browseSavePath(): Promise<void> {
  const path = await invoke<string | null>(INVOKE_CHANNELS.dialogPickSaveFile, keyPath.value)
  if (path) {
    keyPath.value = path
  }
}

async function generate(): Promise<void> {
  generating.value = true
  error.value = null
  try {
    result.value = await invoke<KeyGenerateResult>(INVOKE_CHANNELS.keysGenerate, {
      keyPath: keyPath.value,
      passphrase: passphrase.value || undefined,
      comment: slugify(props.suggestedName ?? '')
    })
    emit('generated', result.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    generating.value = false
  }
}

async function copyPublicKey(): Promise<void> {
  if (!result.value) {
    return
  }
  try {
    await navigator.clipboard.writeText(result.value.publicKey)
    notify.success('Public key copied')
  } catch (e) {
    notify.error('Could not copy public key', e instanceof Error ? e.message : String(e))
  }
}

function close(): void {
  emit('update:open', false)
}
</script>

<template>
  <UModal
    :open="open"
    title="Generate SSH key"
    description="Creates a new ed25519 keypair."
    :ui="{ footer: 'justify-end' }"
    @update:open="(v: boolean) => { if (!v) close() }"
  >
    <template #body>
      <div v-if="!result" class="flex flex-col gap-3">
        <UFormField label="Save as">
          <div class="flex gap-2">
            <UInput v-model="keyPath" class="w-full flex-1" />
            <UButton color="neutral" variant="outline" @click="browseSavePath">Browse</UButton>
          </div>
        </UFormField>
        <UFormField label="Passphrase" hint="Optional — requires a system ssh-keygen to encrypt">
          <UInput v-model="passphrase" type="password" placeholder="Leave blank for no passphrase" class="w-full" />
        </UFormField>
        <UAlert v-if="error" color="error" variant="soft" :title="error" />
      </div>
      <div v-else class="flex flex-col gap-3">
        <UAlert color="success" variant="soft" title="Key generated" :description="result.privateKeyPath" />
        <UFormField label="Public key">
          <div class="flex gap-2">
            <UTextarea :model-value="result.publicKey" readonly :rows="3" class="w-full flex-1 font-mono text-xs" />
            <UButton color="neutral" variant="outline" icon="i-lucide-copy" @click="copyPublicKey">Copy</UButton>
          </div>
        </UFormField>
        <p class="text-xs text-muted">
          Append this line to the target server's <span class="font-mono">~/.ssh/authorized_keys</span>.
        </p>
      </div>
    </template>

    <template #footer>
      <UButton color="neutral" variant="outline" @click="close">{{ result ? 'Close' : 'Cancel' }}</UButton>
      <UButton v-if="!result" :loading="generating" :disabled="!keyPath.trim()" @click="generate">Generate</UButton>
    </template>
  </UModal>
</template>
