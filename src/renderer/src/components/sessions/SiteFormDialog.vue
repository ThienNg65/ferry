<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { AuthMethod, Site, SiteInput } from '@shared/contract'
import { invoke } from '../../api'
import { useSitesStore } from '../../stores/sites.store'

const props = defineProps<{
  open: boolean
  site?: Site | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const sites = useSitesStore()
const saving = ref(false)
const error = ref<string | null>(null)

const form = reactive<SiteInput>({
  name: '',
  host: '',
  port: 22,
  username: '',
  authMethod: 'password',
  privateKeyPath: '',
  remoteInitialPath: '',
  localInitialPath: '',
  password: '',
  passphrase: ''
})

function resetForm(site?: Site | null): void {
  form.name = site?.name ?? ''
  form.host = site?.host ?? ''
  form.port = site?.port ?? 22
  form.username = site?.username ?? ''
  form.authMethod = site?.authMethod ?? 'password'
  form.privateKeyPath = site?.privateKeyPath ?? ''
  form.remoteInitialPath = site?.remoteInitialPath ?? ''
  form.localInitialPath = site?.localInitialPath ?? ''
  form.password = ''
  form.passphrase = ''
  error.value = null
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      resetForm(props.site)
    }
  }
)

const isEdit = computed(() => Boolean(props.site))
const passwordPlaceholder = computed(() =>
  props.site?.hasPassword ? 'Leave blank to keep current password' : 'Password'
)
const passphrasePlaceholder = computed(() =>
  props.site?.hasPassphrase ? 'Leave blank to keep current passphrase' : 'Passphrase (optional)'
)
const canSave = computed(() => form.host.trim().length > 0 && form.username.trim().length > 0)

const authOptions: { label: string; value: AuthMethod }[] = [
  { label: 'Password', value: 'password' },
  { label: 'Private key', value: 'privateKey' }
]

async function browsePrivateKey(): Promise<void> {
  const path = await invoke<string | null>(INVOKE_CHANNELS.dialogPickFile)
  if (path) {
    form.privateKeyPath = path
  }
}

function close(): void {
  emit('update:open', false)
}

async function save(): Promise<void> {
  if (!canSave.value) {
    return
  }
  saving.value = true
  error.value = null
  const input: SiteInput = {
    name: form.name,
    host: form.host,
    port: form.port,
    username: form.username,
    authMethod: form.authMethod,
    privateKeyPath: form.authMethod === 'privateKey' ? form.privateKeyPath || undefined : undefined,
    remoteInitialPath: form.remoteInitialPath || undefined,
    localInitialPath: form.localInitialPath || undefined,
    password: form.password ? form.password : undefined,
    passphrase: form.passphrase ? form.passphrase : undefined
  }
  try {
    if (props.site) {
      await sites.updateSite(props.site.id, input)
    } else {
      await sites.createSite(input)
    }
    close()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="isEdit ? 'Edit site' : 'Add site'"
    description="Saved sites appear in the connect list for one-click access."
    :ui="{ footer: 'justify-end' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <UFormField label="Name" hint="Optional">
          <UInput v-model="form.name" :placeholder="form.host || 'Defaults to hostname'" class="w-full" />
        </UFormField>
        <div class="flex gap-3">
          <UFormField label="Host" class="flex-1">
            <UInput v-model="form.host" placeholder="example.com" class="w-full" />
          </UFormField>
          <UFormField label="Port" class="w-24">
            <UInput v-model.number="form.port" type="number" class="w-full" />
          </UFormField>
        </div>
        <UFormField label="Username">
          <UInput v-model="form.username" class="w-full" />
        </UFormField>
        <UFormField label="Authentication">
          <URadioGroup v-model="form.authMethod" :items="authOptions" orientation="horizontal" />
        </UFormField>
        <UFormField v-if="form.authMethod === 'password'" label="Password">
          <UInput v-model="form.password" type="password" :placeholder="passwordPlaceholder" class="w-full" />
        </UFormField>
        <template v-else>
          <UFormField label="Private key file">
            <div class="flex gap-2">
              <UInput v-model="form.privateKeyPath" placeholder="Path to private key" class="w-full flex-1" />
              <UButton color="neutral" variant="outline" @click="browsePrivateKey">Browse</UButton>
            </div>
          </UFormField>
          <UFormField label="Passphrase">
            <UInput
              v-model="form.passphrase"
              type="password"
              :placeholder="passphrasePlaceholder"
              class="w-full"
            />
          </UFormField>
        </template>
        <div class="flex gap-3">
          <UFormField label="Remote start path" hint="Optional" class="flex-1">
            <UInput v-model="form.remoteInitialPath" placeholder="/" class="w-full" />
          </UFormField>
          <UFormField label="Local start path" hint="Optional" class="flex-1">
            <UInput v-model="form.localInitialPath" class="w-full" />
          </UFormField>
        </div>
        <UAlert v-if="error" color="error" variant="soft" :title="error" />
      </div>
    </template>

    <template #footer="{ close: closeModal }">
      <UButton color="neutral" variant="outline" @click="closeModal">Cancel</UButton>
      <UButton :loading="saving" :disabled="!canSave" @click="save">
        {{ isEdit ? 'Save' : 'Add site' }}
      </UButton>
    </template>
  </UModal>
</template>
