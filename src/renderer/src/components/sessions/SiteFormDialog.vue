<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { AuthMethod, JumpHostConfig, KeyGenerateResult, ProxyConfig, ProxyType, Site, SiteInput } from '@shared/contract'
import { invoke } from '../../api'
import { useSitesStore } from '../../stores/sites.store'
// Not yet used elsewhere in the app, so not in the auto-generated global
// components.d.ts yet — deep-import instead of relying on <USwitch> (see
// FileRow.vue's ContextMenu for the same pattern).
import USwitch from '@nuxt/ui/components/Switch.vue'
import JumpHostHopEditor, { type JumpHopForm } from './JumpHostHopEditor.vue'
import GenerateKeyDialog from './GenerateKeyDialog.vue'

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
  agentPath: '',
  remoteInitialPath: '',
  localInitialPath: '',
  password: '',
  passphrase: '',
  group: ''
})

function emptyHop(): JumpHopForm {
  return { host: '', port: 22, username: '', authMethod: 'password', privateKeyPath: '', password: '', passphrase: '' }
}

const useJumpHost = ref(false)
const jumpHops = ref<JumpHopForm[]>([])

function addHop(): void {
  jumpHops.value.push(emptyHop())
}

function removeHop(index: number): void {
  jumpHops.value.splice(index, 1)
  if (jumpHops.value.length === 0) {
    useJumpHost.value = false
  }
}

function moveHop(index: number, direction: -1 | 1): void {
  const target = index + direction
  if (target < 0 || target >= jumpHops.value.length) {
    return
  }
  const hops = jumpHops.value
  ;[hops[index], hops[target]] = [hops[target], hops[index]]
}

watch(useJumpHost, (enabled) => {
  if (enabled && jumpHops.value.length === 0) {
    addHop()
  }
})

const proxyMode = ref<'inherit' | 'none' | 'custom'>('inherit')
const proxyType = ref<ProxyType>('socks5')
const proxyHost = ref('')
const proxyPort = ref(1080)
const proxyUsername = ref('')
const proxyPassword = ref('')

const proxyModeOptions: { label: string; value: 'inherit' | 'none' | 'custom' }[] = [
  { label: 'Use app default', value: 'inherit' },
  { label: 'No proxy', value: 'none' },
  { label: 'Custom', value: 'custom' }
]
const proxyTypeOptions: { label: string; value: ProxyType }[] = [
  { label: 'SOCKS5', value: 'socks5' },
  { label: 'HTTP CONNECT', value: 'http' }
]

function resetForm(site?: Site | null): void {
  form.name = site?.name ?? ''
  form.host = site?.host ?? ''
  form.port = site?.port ?? 22
  form.username = site?.username ?? ''
  form.authMethod = site?.authMethod ?? 'password'
  form.privateKeyPath = site?.privateKeyPath ?? ''
  form.agentPath = site?.agentPath ?? ''
  form.remoteInitialPath = site?.remoteInitialPath ?? ''
  form.localInitialPath = site?.localInitialPath ?? ''
  form.password = ''
  form.passphrase = ''
  form.group = site?.group ?? ''
  useJumpHost.value = Boolean(site?.jumpHosts?.length)
  jumpHops.value = (site?.jumpHosts ?? []).map((hop) => ({
    host: hop.host,
    port: hop.port,
    username: hop.username,
    authMethod: hop.authMethod,
    privateKeyPath: hop.privateKeyPath ?? '',
    password: '',
    passphrase: ''
  }))
  proxyMode.value = site?.proxyMode ?? 'inherit'
  proxyType.value = site?.proxy?.type ?? 'socks5'
  proxyHost.value = site?.proxy?.host ?? ''
  proxyPort.value = site?.proxy?.port ?? 1080
  proxyUsername.value = site?.proxy?.username ?? ''
  proxyPassword.value = ''
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
const canSave = computed(
  () =>
    form.host.trim().length > 0 &&
    form.username.trim().length > 0 &&
    (!useJumpHost.value || jumpHops.value.every((hop) => hop.host.trim().length > 0 && hop.username.trim().length > 0))
)

const authOptions: { label: string; value: AuthMethod }[] = [
  { label: 'Password', value: 'password' },
  { label: 'Private key', value: 'privateKey' },
  { label: 'SSH agent', value: 'agent' }
]

/** The matching saved hop's hasPassword/hasPassphrase, by index — used only for the "leave blank to keep current" placeholder text. */
function savedHopAt(index: number): { hasPassword: boolean; hasPassphrase: boolean } | undefined {
  return props.site?.jumpHosts?.[index]
}

const proxyPasswordPlaceholder = computed(() =>
  props.site?.proxy?.hasPassword ? 'Leave blank to keep current password' : 'Password (optional)'
)

async function browsePrivateKey(): Promise<void> {
  const path = await invoke<string | null>(INVOKE_CHANNELS.dialogPickFile)
  if (path) {
    form.privateKeyPath = path
  }
}

const generateKeyOpen = ref(false)

function onKeyGenerated(result: KeyGenerateResult): void {
  form.privateKeyPath = result.privateKeyPath
  form.authMethod = 'privateKey'
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
  const jumpHosts: JumpHostConfig[] | undefined = useJumpHost.value
    ? jumpHops.value.map((hop) => ({
        host: hop.host,
        port: hop.port,
        username: hop.username,
        authMethod: hop.authMethod,
        privateKeyPath: hop.authMethod === 'privateKey' ? hop.privateKeyPath || undefined : undefined,
        password: hop.password ? hop.password : undefined,
        passphrase: hop.passphrase ? hop.passphrase : undefined
      }))
    : undefined
  const proxy: ProxyConfig | undefined =
    proxyMode.value === 'custom'
      ? {
          type: proxyType.value,
          host: proxyHost.value,
          port: proxyPort.value,
          username: proxyUsername.value || undefined,
          password: proxyPassword.value ? proxyPassword.value : undefined
        }
      : undefined
  const input: SiteInput = {
    name: form.name,
    host: form.host,
    port: form.port,
    username: form.username,
    authMethod: form.authMethod,
    privateKeyPath: form.authMethod === 'privateKey' ? form.privateKeyPath || undefined : undefined,
    agentPath: form.authMethod === 'agent' ? form.agentPath || undefined : undefined,
    remoteInitialPath: form.remoteInitialPath || undefined,
    localInitialPath: form.localInitialPath || undefined,
    password: form.password ? form.password : undefined,
    passphrase: form.passphrase ? form.passphrase : undefined,
    jumpHosts,
    proxyMode: proxyMode.value,
    proxy,
    group: (form.group ?? '').trim() || undefined
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
        <div class="flex gap-3">
          <UFormField label="Name" hint="Optional" class="flex-1">
            <UInput v-model="form.name" :placeholder="form.host || 'Defaults to hostname'" class="w-full" />
          </UFormField>
          <UFormField label="Group" hint="Optional" class="flex-1">
            <UInput v-model="form.group" list="ferry-site-groups" placeholder="e.g. Work" class="w-full" />
          </UFormField>
        </div>
        <datalist id="ferry-site-groups">
          <option v-for="name in sites.groupNames" :key="name" :value="name" />
        </datalist>
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
        <template v-else-if="form.authMethod === 'privateKey'">
          <UFormField label="Private key file">
            <div class="flex gap-2">
              <UInput v-model="form.privateKeyPath" placeholder="Path to private key" class="w-full flex-1" />
              <UButton color="neutral" variant="outline" @click="browsePrivateKey">Browse</UButton>
              <UButton color="neutral" variant="outline" icon="i-lucide-key-round" @click="generateKeyOpen = true">
                Generate
              </UButton>
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
        <UFormField
          v-else
          label="Agent path"
          hint="Optional"
          description="Defaults to the Windows OpenSSH Agent pipe, or $SSH_AUTH_SOCK. Set to 'pageant' to use Pageant instead."
        >
          <UInput v-model="form.agentPath" placeholder="Leave blank for the platform default" class="w-full" />
        </UFormField>
        <div class="flex gap-3">
          <UFormField label="Remote start path" hint="Optional" class="flex-1">
            <UInput v-model="form.remoteInitialPath" placeholder="/" class="w-full" />
          </UFormField>
          <UFormField label="Local start path" hint="Optional" class="flex-1">
            <UInput v-model="form.localInitialPath" class="w-full" />
          </UFormField>
        </div>

        <div class="flex items-center justify-between rounded-md border border-default px-3 py-2">
          <div>
            <div class="text-sm font-medium text-highlighted">Connect through a jump host</div>
            <div class="text-xs text-muted">Tunnels the connection through one or more bastion hosts first.</div>
          </div>
          <USwitch v-model="useJumpHost" />
        </div>
        <template v-if="useJumpHost">
          <JumpHostHopEditor
            v-for="(hop, index) in jumpHops"
            :key="index"
            :model-value="hop"
            :index="index"
            :total="jumpHops.length"
            :has-password="savedHopAt(index)?.hasPassword"
            :has-passphrase="savedHopAt(index)?.hasPassphrase"
            @update:model-value="(v) => (jumpHops[index] = v)"
            @remove="removeHop(index)"
            @move-up="moveHop(index, -1)"
            @move-down="moveHop(index, 1)"
          />
          <UButton color="neutral" variant="outline" icon="i-lucide-plus" class="self-start" @click="addHop">
            Add hop
          </UButton>
        </template>

        <UFormField label="Proxy">
          <URadioGroup v-model="proxyMode" :items="proxyModeOptions" orientation="horizontal" />
        </UFormField>
        <template v-if="proxyMode === 'custom'">
          <URadioGroup v-model="proxyType" :items="proxyTypeOptions" orientation="horizontal" />
          <div class="flex gap-3">
            <UFormField label="Proxy host" class="flex-1">
              <UInput v-model="proxyHost" placeholder="proxy.example.com" class="w-full" />
            </UFormField>
            <UFormField label="Port" class="w-24">
              <UInput v-model.number="proxyPort" type="number" class="w-full" />
            </UFormField>
          </div>
          <div class="flex gap-3">
            <UFormField label="Username" hint="Optional" class="flex-1">
              <UInput v-model="proxyUsername" class="w-full" />
            </UFormField>
            <UFormField label="Password" hint="Optional" class="flex-1">
              <UInput v-model="proxyPassword" type="password" :placeholder="proxyPasswordPlaceholder" class="w-full" />
            </UFormField>
          </div>
        </template>

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
  <GenerateKeyDialog
    v-model:open="generateKeyOpen"
    :suggested-name="form.name || form.host"
    @generated="onKeyGenerated"
  />
</template>
