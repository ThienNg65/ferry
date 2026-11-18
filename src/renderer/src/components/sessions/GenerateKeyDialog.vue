<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { KeyGenerateResult } from '@shared/contract'
import { invoke } from '../../api'
import { useNotify } from '../../composables/useNotify'
import PasswordInput from '../shell/PasswordInput.vue'

const props = defineProps<{
  open: boolean
  /** Used only to seed the suggested filename, e.g. the site name being configured. */
  suggestedName?: string
  /** When true, renders inline inside an outer dialog so no nested UModal focus trap is created. */
  embedded?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:generating': [value: boolean]
  generated: [result: KeyGenerateResult]
}>()

const notify = useNotify()
const keyPath = ref('')
const passphrase = ref('')
const confirmPassphrase = ref('')
const generating = ref(false)
const error = ref<string | null>(null)
const result = ref<KeyGenerateResult | null>(null)
const copied = ref(false)

watch(generating, (val) => emit('update:generating', val))

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'site'
}

function reset(): void {
  keyPath.value = `id_ed25519_${slugify(props.suggestedName ?? '')}`
  passphrase.value = ''
  confirmPassphrase.value = ''
  error.value = null
  result.value = null
  copied.value = false
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      reset()
    }
  },
  { immediate: true }
)

const passphraseMismatch = computed(() =>
  passphrase.value.length > 0 && confirmPassphrase.value.length > 0 && passphrase.value !== confirmPassphrase.value
    ? 'Passphrases do not match'
    : ''
)

const canGenerate = computed(
  () =>
    keyPath.value.trim().length > 0 &&
    (passphrase.value.length === 0 || passphrase.value === confirmPassphrase.value)
)

async function browseSavePath(): Promise<void> {
  const path = await invoke<string | null>(INVOKE_CHANNELS.dialogPickSaveFile, keyPath.value)
  if (path) {
    keyPath.value = path
  }
}

async function generate(): Promise<void> {
  if (!canGenerate.value || generating.value) return
  generating.value = true
  error.value = null
  try {
    result.value = await invoke<KeyGenerateResult>(INVOKE_CHANNELS.keysGenerate, {
      keyPath: keyPath.value.trim(),
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
    copied.value = true
    notify.success('Public key copied')
  } catch (e) {
    notify.error('Could not copy public key', e instanceof Error ? e.message : String(e))
  }
}

function close(): void {
  if (generating.value) return
  emit('update:open', false)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <form v-if="!result" id="ferry-keygen-form" class="flex flex-col gap-3" @submit.prevent="generate">
      <UFormField
        label="Save as"
        required
        description="Relative filenames are saved inside your ~/.ssh/ directory."
      >
        <div class="flex flex-col gap-2 sm:flex-row">
          <UInput v-model="keyPath" class="w-full flex-1" />
          <UButton color="neutral" variant="outline" aria-label="Browse key save path" @click="browseSavePath">Browse</UButton>
        </div>
      </UFormField>
      <UFormField label="Passphrase" hint="Optional — requires system ssh-keygen">
        <PasswordInput
          v-model="passphrase"
          label="passphrase"
          placeholder="Leave blank for no passphrase"
          class="w-full"
        />
      </UFormField>
      <UFormField
        v-if="passphrase.length > 0"
        label="Confirm passphrase"
        required
        :error="passphraseMismatch || undefined"
      >
        <PasswordInput
          v-model="confirmPassphrase"
          label="passphrase confirmation"
          placeholder="Re-enter passphrase"
          class="w-full"
        />
      </UFormField>
      <UAlert v-if="error" role="alert" color="error" variant="soft" :title="error" />
    </form>
    <div v-else class="flex flex-col gap-3">
      <div role="status" aria-live="polite">
        <UAlert color="success" variant="soft" title="Key generated" :description="result.privateKeyPath" />
      </div>
      <UFormField label="Public key">
        <div class="flex flex-col items-start gap-2 sm:flex-row">
          <UTextarea :model-value="result.publicKey" readonly :rows="3" class="w-full flex-1 font-mono text-xs" />
          <UButton
            color="neutral"
            variant="outline"
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            @click="copyPublicKey"
          >
            {{ copied ? 'Copied' : 'Copy' }}
          </UButton>
        </div>
      </UFormField>
      <p class="text-xs text-muted">
        Append this line to the target server's <span class="font-mono">~/.ssh/authorized_keys</span>.
      </p>
    </div>

    <div class="flex flex-wrap justify-end gap-2 border-t border-default pt-3">
      <UButton color="neutral" variant="outline" :disabled="generating" @click="close">
        {{ result ? 'Back to site' : 'Cancel' }}
      </UButton>
      <UButton v-if="!result" type="submit" form="ferry-keygen-form" :loading="generating" :disabled="!canGenerate">
        Generate
      </UButton>
    </div>
  </div>
</template>
