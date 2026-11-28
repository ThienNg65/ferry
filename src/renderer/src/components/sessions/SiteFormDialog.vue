<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { AuthMethod, JumpHostConfig, KeyGenerateResult, ProxyConfig, ProxyType, Site, SiteEnvironment, SiteInput } from '@shared/contract'
import { ENVIRONMENT_OPTIONS } from '../../utils/environment'
import { invoke } from '../../api'
import { useSitesStore } from '../../stores/sites.store'
import { useConfirm } from '../../composables/useConfirm'
import { useNotify } from '../../composables/useNotify'
// Not yet used elsewhere in the app, so not in the auto-generated global
// components.d.ts yet — deep-import instead of relying on <USwitch>/<UCollapsible>
// (see FileRow.vue's ContextMenu for the same pattern).
import USwitch from '@nuxt/ui/components/Switch.vue'
import UCollapsible from '@nuxt/ui/components/Collapsible.vue'
import PasswordInput from '../shell/PasswordInput.vue'
import { shouldExpandAdvanced } from '../../utils/advancedSiteOptions'
import JumpHostHopEditor, { type JumpHopForm } from './JumpHostHopEditor.vue'
import GenerateKeyDialog from './GenerateKeyDialog.vue'

const props = defineProps<{
  open: boolean
  site?: Site | null
  initialValues?: Partial<SiteInput> | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: [site: Site]
  'saved-and-connect': [site: Site]
}>()

const sites = useSitesStore()
const confirm = useConfirm()
const generatingKey = ref(false)
const generateKeyOpen = ref(false)
const saving = ref(false)
const savingAndConnect = ref(false)
const error = ref<string | null>(null)
const showValidation = ref(false)
const touched = reactive({
  host: false,
  port: false,
  username: false,
  privateKeyPath: false,
  proxyHost: false,
  proxyPort: false
})

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
const environment = ref<SiteEnvironment | 'none'>('none')

function emptyHop(): JumpHopForm {
  return {
    id: crypto.randomUUID(),
    host: '',
    port: 22,
    username: '',
    authMethod: 'password',
    privateKeyPath: '',
    password: '',
    passphrase: ''
  }
}

const useJumpHost = ref(false)
const jumpHops = ref<JumpHopForm[]>([])
const advancedOpen = ref(false)

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

const initialSnapshot = ref('')

function currentSnapshot(): string {
  return JSON.stringify({
    form: { ...form },
    environment: environment.value,
    useJumpHost: useJumpHost.value,
    jumpHops: jumpHops.value.map(({ id: _id, ...rest }) => rest),
    proxyMode: proxyMode.value,
    proxyType: proxyType.value,
    proxyHost: proxyHost.value,
    proxyPort: proxyPort.value,
    proxyUsername: proxyUsername.value,
    proxyPassword: proxyPassword.value
  })
}

const isDirty = computed(() => props.open && initialSnapshot.value !== '' && currentSnapshot() !== initialSnapshot.value)

const dirty = reactive({ host: false, port: false, username: false, privateKeyPath: false, proxyHost: false, proxyPort: false })

function resetForm(seed?: Site | Partial<SiteInput> | null): void {
  form.name = seed?.name ?? ''
  form.host = seed?.host ?? ''
  form.port = seed?.port ?? 22
  form.username = seed?.username ?? ''
  form.authMethod = seed?.authMethod ?? 'password'
  form.privateKeyPath = seed?.privateKeyPath ?? ''
  form.agentPath = seed?.agentPath ?? ''
  form.remoteInitialPath = seed?.remoteInitialPath ?? ''
  form.localInitialPath = seed?.localInitialPath ?? ''
  form.password = ''
  form.passphrase = ''
  form.group = seed?.group ?? ''
  environment.value = seed?.environment ?? 'none'
  useJumpHost.value = Boolean(seed?.jumpHosts?.length)
  jumpHops.value = (seed?.jumpHosts ?? []).map((hop, index) => ({
    id: crypto.randomUUID(),
    sourceIndex: index,
    host: hop.host,
    port: hop.port,
    username: hop.username,
    authMethod: hop.authMethod,
    privateKeyPath: hop.privateKeyPath ?? '',
    password: '',
    passphrase: ''
  }))
  proxyMode.value = seed?.proxyMode ?? 'inherit'
  proxyType.value = seed?.proxy?.type ?? 'socks5'
  proxyHost.value = seed?.proxy?.host ?? ''
  proxyPort.value = seed?.proxy?.port ?? 1080
  proxyUsername.value = seed?.proxy?.username ?? ''
  proxyPassword.value = ''
  advancedOpen.value = shouldExpandAdvanced(
    seed ? { jumpHosts: seed.jumpHosts as Site['jumpHosts'], proxyMode: seed.proxyMode } : null
  )
  showValidation.value = false
  touched.host = false
  touched.port = false
  touched.username = false
  touched.privateKeyPath = false
  touched.proxyHost = false
  touched.proxyPort = false
  dirty.host = false
  dirty.port = false
  dirty.username = false
  dirty.privateKeyPath = false
  dirty.proxyHost = false
  dirty.proxyPort = false
  generateKeyOpen.value = false
  error.value = null
  initialSnapshot.value = currentSnapshot()
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      resetForm(props.site ?? props.initialValues)
    }
  },
  { immediate: true }
)

function isValidPort(value: unknown): boolean {
  const n = Number(value)
  return (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) &&
    Number.isInteger(n) &&
    n >= 1 &&
    n <= 65535
}

const isEdit = computed(() => Boolean(props.site))
const passwordPlaceholder = computed(() =>
  props.site?.hasPassword ? 'Leave blank to keep current password' : 'Password'
)
const passphrasePlaceholder = computed(() =>
  props.site?.hasPassphrase ? 'Leave blank to keep current passphrase' : 'Passphrase (optional)'
)
const hostError = computed(() =>
  (touched.host || showValidation.value) && !form.host.trim() ? 'Host is required' : ''
)
const usernameError = computed(() =>
  (touched.username || showValidation.value) && !form.username.trim() ? 'Username is required' : ''
)
const privateKeyError = computed(() =>
  form.authMethod === 'privateKey' &&
  (touched.privateKeyPath || showValidation.value) &&
  !form.privateKeyPath?.trim()
    ? 'Private key file is required'
    : ''
)
const portError = computed(() => {
  if (!touched.port && !showValidation.value) return ''
  return isValidPort(form.port) ? '' : 'Port must be between 1 and 65535'
})
const proxyHostError = computed(() =>
  proxyMode.value === 'custom' && (touched.proxyHost || showValidation.value) && !proxyHost.value.trim()
    ? 'Proxy host is required'
    : ''
)
const proxyPortError = computed(() => {
  if (proxyMode.value !== 'custom' || (!touched.proxyPort && !showValidation.value)) return ''
  return !isValidPort(proxyPort.value) ? 'Port must be between 1 and 65535' : ''
})
const canSave = computed(
  () =>
    form.host.trim().length > 0 &&
    form.username.trim().length > 0 &&
    isValidPort(form.port) &&
    (form.authMethod !== 'privateKey' || (form.privateKeyPath ?? '').trim().length > 0) &&
    (!useJumpHost.value ||
      jumpHops.value.every(
        (hop) =>
          hop.host.trim().length > 0 &&
          hop.username.trim().length > 0 &&
          isValidPort(hop.port) &&
          (hop.authMethod !== 'privateKey' || hop.privateKeyPath.trim().length > 0)
      )) &&
    (proxyMode.value !== 'custom' ||
      (proxyHost.value.trim().length > 0 && isValidPort(proxyPort.value)))
)

/** True while an incomplete jump host is the reason Save is disabled — used to force the Advanced section open so the offending fields are never hidden. */
const jumpHostIncomplete = computed(
  () =>
    useJumpHost.value &&
    jumpHops.value.some(
      (hop) =>
        hop.host.trim().length === 0 ||
        hop.username.trim().length === 0 ||
        !isValidPort(hop.port) ||
        (hop.authMethod === 'privateKey' && hop.privateKeyPath.trim().length === 0)
    )
)

const proxyIncomplete = computed(
  () => proxyMode.value === 'custom' && (proxyHost.value.trim().length === 0 || !isValidPort(proxyPort.value))
)

const authOptions: { label: string; value: AuthMethod }[] = [
  { label: 'Password', value: 'password' },
  { label: 'Private key', value: 'privateKey' },
  { label: 'SSH agent', value: 'agent' }
]

/** Looks up the matching saved hop's hasPassword/hasPassphrase via its original `sourceIndex` so reordering hops keeps accurate hints. */
function savedHopFor(hop: JumpHopForm): { hasPassword: boolean; hasPassphrase: boolean } | undefined {
  if (hop.sourceIndex === undefined) return undefined
  return props.site?.jumpHosts?.[hop.sourceIndex]
}

const proxyPasswordPlaceholder = computed(() =>
  props.site?.proxy?.hasPassword ? 'Leave blank to keep current password' : 'Password (optional)'
)

const notify = useNotify()

async function browsePrivateKey(): Promise<void> {
  const path = await invoke<string | null>(INVOKE_CHANNELS.dialogPickFile)
  if (path) {
    form.privateKeyPath = path
    dirty.privateKeyPath = true
  } else if (!(window as { NL_ARGS?: unknown }).NL_ARGS) {
    notify.error('Native picker unavailable', 'Type or paste the private key path in browser mode.')
  }
}

async function browseLocalPath(): Promise<void> {
  const path = await invoke<string | null>(INVOKE_CHANNELS.dialogPickFolder)
  if (path) {
    form.localInitialPath = path
  }
}

function onKeyGenerated(result: KeyGenerateResult): void {
  form.privateKeyPath = result.privateKeyPath
  form.authMethod = 'privateKey'
}

function onModalEscapeKeyDown(event: KeyboardEvent): void {
  if (document.querySelector('[data-reka-popper-content-wrapper]')) {
    event.preventDefault()
  }
}

async function requestClose(): Promise<void> {
  if (saving.value || generatingKey.value) return
  if (generateKeyOpen.value) {
    generateKeyOpen.value = false
    return
  }
  if (isDirty.value) {
    const discard = await confirm({
      title: 'Discard unsaved changes?',
      body: 'You have unsaved site configuration changes. Discard them and close?',
      confirmLabel: 'Discard',
      confirmColor: 'error',
      destructive: true
    })
    if (!discard) return
  }
  emit('update:open', false)
}

async function save(andConnect = false): Promise<void> {
  showValidation.value = true
  if (!canSave.value) {
    if (jumpHostIncomplete.value || proxyIncomplete.value) {
      advancedOpen.value = true
    }
    return
  }
  saving.value = true
  savingAndConnect.value = andConnect
  error.value = null
  const jumpHosts: JumpHostConfig[] | undefined = useJumpHost.value
    ? jumpHops.value.map((hop) => ({
        host: hop.host.trim(),
        port: Number(hop.port),
        username: hop.username.trim(),
        authMethod: hop.authMethod,
        privateKeyPath: hop.authMethod === 'privateKey' ? hop.privateKeyPath.trim() || undefined : undefined,
        password: hop.password ? hop.password : undefined,
        passphrase: hop.passphrase ? hop.passphrase : undefined,
        sourceIndex: hop.sourceIndex ?? -1
      }))
    : undefined
  const proxy: ProxyConfig | undefined =
    proxyMode.value === 'custom'
      ? {
          type: proxyType.value,
          host: proxyHost.value.trim(),
          port: proxyPort.value,
          username: proxyUsername.value.trim() || undefined,
          password: proxyPassword.value ? proxyPassword.value : undefined
        }
      : undefined
  const input: SiteInput = {
    name: form.name.trim(),
    host: form.host.trim(),
    port: form.port,
    username: form.username.trim(),
    authMethod: form.authMethod,
    privateKeyPath: form.authMethod === 'privateKey' ? form.privateKeyPath?.trim() || undefined : undefined,
    agentPath: form.authMethod === 'agent' ? form.agentPath?.trim() || undefined : undefined,
    remoteInitialPath: form.remoteInitialPath?.trim() || undefined,
    localInitialPath: form.localInitialPath?.trim() || undefined,
    password: form.password ? form.password : undefined,
    passphrase: form.passphrase ? form.passphrase : undefined,
    jumpHosts,
    proxyMode: proxyMode.value,
    proxy,
    group: (form.group ?? '').trim() || undefined,
    environment: environment.value === 'none' ? undefined : environment.value
  }
  try {
    const saved = props.site
      ? await sites.updateSite(props.site.id, input)
      : await sites.createSite(input)
    emit('saved', saved)
    if (andConnect) {
      emit('saved-and-connect', saved)
    }
    emit('update:open', false)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
    savingAndConnect.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :dismissible="!saving && !generatingKey"
    :close="!saving && !generatingKey"
    :title="generateKeyOpen ? 'Generate SSH key' : isEdit ? 'Edit site' : 'Add site'"
    :description="
      generateKeyOpen
        ? 'Creates a new ed25519 keypair and links it to this site.'
        : 'Saved sites appear in the connect list for one-click access.'
    "
    :ui="{ footer: 'flex-wrap justify-end' }"
    :content="{ onEscapeKeyDown: onModalEscapeKeyDown }"
    @update:open="(v: boolean) => { if (!v) void requestClose() }"
  >
    <template #body>
      <GenerateKeyDialog
        v-if="generateKeyOpen"
        embedded
        :open="generateKeyOpen"
        :suggested-name="form.name || form.host"
        @update:open="(v: boolean) => { generateKeyOpen = v }"
        @update:generating="(v: boolean) => { generatingKey = v }"
        @generated="onKeyGenerated"
      />
      <form v-else id="ferry-site-form" class="flex flex-col gap-3" @submit.prevent="save(false)">
        <div class="flex flex-col gap-3 sm:flex-row">
          <UFormField label="Name" hint="Optional" class="flex-1">
            <UInput v-model="form.name" :placeholder="form.host || 'Defaults to hostname'" class="w-full" />
          </UFormField>
          <UFormField label="Group" hint="Optional" class="flex-1">
            <UInput v-model="form.group" placeholder="e.g. Work" class="w-full" />
            <div v-if="sites.groupNames.length > 0" class="mt-1.5 flex flex-wrap gap-1">
              <button
                v-for="name in sites.groupNames"
                :key="name"
                type="button"
                class="rounded bg-muted px-2 py-1 text-xs text-muted transition-colors hover:bg-accented hover:text-highlighted focus-visible:outline-2 focus-visible:outline-primary"
                @click="form.group = name"
              >
                {{ name }}
              </button>
            </div>
          </UFormField>
        </div>
        <UFormField label="Environment" hint="Optional. Colors the tab">
          <USelect v-model="environment" :items="ENVIRONMENT_OPTIONS" class="w-full" />
        </UFormField>
        <div class="flex flex-col gap-3 sm:flex-row">
          <UFormField label="Host" required :error="hostError || undefined" class="flex-1">
            <UInput
              v-model="form.host"
              placeholder="example.com"
              class="w-full"
              @input="dirty.host = true"
              @blur="dirty.host && (touched.host = true)"
            />
          </UFormField>
          <UFormField label="Port" required :error="portError || undefined" class="w-full sm:w-28" :ui="{ error: 'text-xs leading-tight' }">
            <UInput
              v-model.number="form.port"
              type="number"
              min="1"
              max="65535"
              class="w-full"
              @input="dirty.port = true"
              @blur="dirty.port && (touched.port = true)"
            />
          </UFormField>
        </div>
        <UFormField label="Username" required :error="usernameError || undefined">
          <UInput
            v-model="form.username"
            placeholder="e.g. root"
            class="w-full"
            @input="dirty.username = true"
            @blur="dirty.username && (touched.username = true)"
          />
        </UFormField>
        <UFormField label="Authentication">
          <URadioGroup
            v-model="form.authMethod"
            :items="authOptions"
            orientation="horizontal"
            :ui="{ fieldset: 'flex-wrap gap-y-1.5' }"
          />
        </UFormField>
        <UFormField v-if="form.authMethod === 'password'" label="Password">
          <PasswordInput
            v-model="form.password"
            label="password"
            :placeholder="passwordPlaceholder"
            class="w-full"
          />
        </UFormField>
        <template v-else-if="form.authMethod === 'privateKey'">
          <UFormField label="Private key file" required :error="privateKeyError || undefined">
            <div class="flex flex-col gap-2 sm:flex-row">
              <UInput
                v-model="form.privateKeyPath"
                placeholder="Path to private key"
                class="w-full flex-1"
                @input="dirty.privateKeyPath = true"
                @blur="dirty.privateKeyPath && (touched.privateKeyPath = true)"
              />
              <div class="flex gap-2">
                <UButton color="neutral" variant="outline" aria-label="Browse private key file" @click="browsePrivateKey">
                  Browse
                </UButton>
                <UButton color="neutral" variant="outline" icon="i-lucide-key-round" @click="generateKeyOpen = true">
                  Generate
                </UButton>
              </div>
            </div>
          </UFormField>
          <UFormField label="Passphrase">
            <PasswordInput
              v-model="form.passphrase"
              label="passphrase"
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
        <div class="flex flex-col gap-3 sm:flex-row">
          <UFormField label="Remote start path" hint="Optional" class="flex-1">
            <UInput v-model="form.remoteInitialPath" placeholder="/" class="w-full" />
          </UFormField>
          <UFormField label="Local start path" hint="Optional" class="flex-1">
            <div class="flex gap-2">
              <UInput v-model="form.localInitialPath" placeholder="Default folder" class="w-full flex-1" />
              <UButton color="neutral" variant="outline" aria-label="Browse local start path" @click="browseLocalPath">
                Browse
              </UButton>
            </div>
          </UFormField>
        </div>

        <UCollapsible :open="advancedOpen || jumpHostIncomplete" @update:open="(value) => (advancedOpen = value)">
          <button
            type="button"
            class="flex w-full items-center justify-between rounded-md border border-default px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-primary"
          >
            <div>
              <div class="text-sm font-medium text-highlighted">Advanced connection options</div>
              <div class="text-xs text-muted">Jump host and proxy settings</div>
            </div>
            <UIcon
              name="i-lucide-chevron-down"
              class="size-4 shrink-0 transition-transform"
              :class="advancedOpen || jumpHostIncomplete ? 'rotate-180' : ''"
            />
          </button>
          <template #content>
            <div class="flex flex-col gap-3 pt-3">
              <div class="flex items-center justify-between rounded-md border border-default px-3 py-2">
                <div>
                  <div class="text-sm font-medium text-highlighted">Connect through a jump host</div>
                  <div class="text-xs text-muted">Tunnels the connection through one or more bastion hosts first.</div>
                </div>
                <USwitch v-model="useJumpHost" aria-label="Connect through a jump host" />
              </div>
              <template v-if="useJumpHost">
                <JumpHostHopEditor
                  v-for="(hop, index) in jumpHops"
                  :key="hop.id"
                  :model-value="hop"
                  :index="index"
                  :total="jumpHops.length"
                  :has-password="savedHopFor(hop)?.hasPassword"
                  :has-passphrase="savedHopFor(hop)?.hasPassphrase"
                  :show-validation="showValidation"
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
                <URadioGroup
                  v-model="proxyMode"
                  :items="proxyModeOptions"
                  orientation="horizontal"
                  :ui="{ fieldset: 'flex-wrap gap-y-1.5' }"
                />
              </UFormField>
              <template v-if="proxyMode === 'custom'">
                <URadioGroup
                  v-model="proxyType"
                  :items="proxyTypeOptions"
                  orientation="horizontal"
                  :ui="{ fieldset: 'flex-wrap gap-y-1.5' }"
                />
                <div class="flex flex-col gap-3 sm:flex-row">
                  <UFormField label="Proxy host" required :error="proxyHostError || undefined" class="flex-1">
                    <UInput
                      v-model="proxyHost"
                      placeholder="proxy.example.com"
                      class="w-full"
                      @input="dirty.proxyHost = true"
                      @blur="dirty.proxyHost && (touched.proxyHost = true)"
                    />
                  </UFormField>
                  <UFormField label="Port" required :error="proxyPortError || undefined" class="w-full sm:w-28" :ui="{ error: 'text-xs leading-tight' }">
                    <UInput
                      v-model.number="proxyPort"
                      type="number"
                      min="1"
                      max="65535"
                      class="w-full"
                      @input="dirty.proxyPort = true"
                      @blur="dirty.proxyPort && (touched.proxyPort = true)"
                    />
                  </UFormField>
                </div>
                <div class="flex flex-col gap-3 sm:flex-row">
                  <UFormField label="Username" hint="Optional" class="flex-1">
                    <UInput v-model="proxyUsername" class="w-full" />
                  </UFormField>
                  <UFormField label="Password" hint="Optional" class="flex-1">
                    <PasswordInput
                      v-model="proxyPassword"
                      label="proxy password"
                      :placeholder="proxyPasswordPlaceholder"
                      class="w-full"
                    />
                  </UFormField>
                </div>
              </template>
            </div>
          </template>
        </UCollapsible>

        <UAlert v-if="error" role="alert" color="error" variant="soft" :title="error" />
      </form>
    </template>

    <template v-if="!generateKeyOpen" #footer>
      <UButton color="neutral" variant="outline" :disabled="saving" @click="requestClose">Cancel</UButton>
      <UButton
        color="neutral"
        variant="soft"
        icon="i-lucide-play"
        :loading="saving && savingAndConnect"
        :disabled="saving"
        @click="save(true)"
      >
        Save &amp; Connect
      </UButton>
      <UButton type="submit" form="ferry-site-form" :loading="saving && !savingAndConnect" :disabled="saving">
        {{ isEdit ? 'Save' : 'Add site' }}
      </UButton>
    </template>
  </UModal>
</template>
