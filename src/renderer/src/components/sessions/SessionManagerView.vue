<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { AppVersionResult, QuickConnectInput, Site } from '@shared/contract'
import { invoke } from '../../api'
import { useSessionsStore } from '../../stores/sessions.store'
import { useSitesStore } from '../../stores/sites.store'
import SiteFormDialog from './SiteFormDialog.vue'
import ImportSessionsDialog from './ImportSessionsDialog.vue'

const sessions = useSessionsStore()
const sites = useSitesStore()
const version = ref('')

const keyboardAnswers = ref<string[]>([])
watch(
  () => sessions.pendingKeyboardPrompt,
  (prompt) => {
    keyboardAnswers.value = prompt ? prompt.prompts.map(() => '') : []
  }
)

async function submitKeyboardAnswers(): Promise<void> {
  await sessions.respondKeyboardInteractive([...keyboardAnswers.value])
}

onMounted(() => {
  void sites.fetchSites()
  void invoke<AppVersionResult>(INVOKE_CHANNELS.systemGetAppVersion).then((result) => {
    version.value = result.version
  })
})

const form = reactive<QuickConnectInput>({
  name: 'Quick Connect',
  host: '',
  port: 22,
  username: '',
  authMethod: 'password',
  password: ''
})

async function onConnect(): Promise<void> {
  try {
    await sessions.connect({ ...form })
  } catch {
    // Surfaced via sessions.status/statusMessage in the template below.
  }
}

async function onConnectSite(site: Site): Promise<void> {
  try {
    await sessions.connectToSite(site)
  } catch {
    // Surfaced via sessions.status/statusMessage in the template below.
  }
}

const formOpen = ref(false)
const editingSite = ref<Site | null>(null)

function openCreateDialog(): void {
  editingSite.value = null
  formOpen.value = true
}

const importOpen = ref(false)

function openEditDialog(site: Site): void {
  editingSite.value = site
  formOpen.value = true
}

const deleteTarget = ref<Site | null>(null)
const deleting = ref(false)

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value) {
    return
  }
  deleting.value = true
  try {
    await sites.deleteSite(deleteTarget.value.id)
    deleteTarget.value = null
  } finally {
    deleting.value = false
  }
}

const duplicatingId = ref<string | null>(null)

async function onDuplicate(site: Site): Promise<void> {
  duplicatingId.value = site.id
  try {
    await sites.duplicateSite(site.id)
  } finally {
    duplicatingId.value = null
  }
}

const searchQuery = ref('')

const filteredSites = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) {
    return sites.sites
  }
  return sites.sites.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.host.toLowerCase().includes(q) ||
      s.username.toLowerCase().includes(q)
  )
})

interface SiteGroupSection {
  /** Null means "no header" — used when no site has a group at all, to keep the plain flat-list look. */
  name: string | null
  sites: Site[]
}

/** Groups by `site.group`, alphabetically; ungrouped sites trail under "Ungrouped" only once some grouping is in use. */
const groupedSites = computed<SiteGroupSection[]>(() => {
  if (!filteredSites.value.some((s) => s.group)) {
    return [{ name: null, sites: filteredSites.value }]
  }
  const byGroup = new Map<string, Site[]>()
  const ungrouped: Site[] = []
  for (const site of filteredSites.value) {
    if (site.group) {
      const list = byGroup.get(site.group) ?? []
      list.push(site)
      byGroup.set(site.group, list)
    } else {
      ungrouped.push(site)
    }
  }
  const sections = Array.from(byGroup.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list]) => ({ name, sites: list }))
  if (ungrouped.length > 0) {
    sections.push({ name: 'Ungrouped', sites: ungrouped })
  }
  return sections
})
</script>

<template>
  <div class="flex h-full items-center justify-center overflow-y-auto bg-default py-8">
    <div class="flex w-full max-w-sm flex-col gap-4">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h1 class="text-base font-medium text-highlighted">Sites</h1>
            <div class="flex items-center gap-1.5">
              <UTooltip text="Import from WinSCP/PuTTY">
                <UButton
                  icon="i-lucide-import"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  @click="importOpen = true"
                />
              </UTooltip>
              <UButton icon="i-lucide-plus" size="xs" variant="soft" @click="openCreateDialog">Add site</UButton>
            </div>
          </div>
        </template>

        <div v-if="sites.loading" class="py-4 text-center text-xs text-muted">Loading sites…</div>
        <div v-else-if="sites.sites.length === 0" class="py-4 text-center text-xs text-muted">
          No saved sites yet — add one, or use Quick Connect below.
        </div>
        <template v-else>
          <UInput
            v-model="searchQuery"
            icon="i-lucide-search"
            placeholder="Search sites…"
            size="xs"
            class="mb-2 w-full"
          />
          <p v-if="filteredSites.length === 0" class="py-4 text-center text-xs text-muted">
            No sites match "{{ searchQuery }}".
          </p>
          <div v-for="section in groupedSites" :key="section.name ?? ''" class="flex flex-col gap-1">
            <div v-if="section.name" class="mt-2 px-2 text-[11px] font-medium uppercase tracking-wide text-muted first:mt-0">
              {{ section.name }}
            </div>
            <ul class="flex flex-col gap-1">
              <li
                v-for="site in section.sites"
                :key="site.id"
                class="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
              >
                <UIcon name="i-lucide-server" class="size-4 shrink-0 text-muted" />
                <button class="min-w-0 flex-1 text-left" @click="onConnectSite(site)">
                  <div class="truncate text-sm font-medium text-highlighted">{{ site.name }}</div>
                  <div class="truncate text-xs text-muted">{{ site.username }}@{{ site.host }}:{{ site.port }}</div>
                </button>
                <UTooltip text="Duplicate site">
                  <UButton
                    icon="i-lucide-copy"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :loading="duplicatingId === site.id"
                    class="opacity-0 group-hover:opacity-100"
                    @click="onDuplicate(site)"
                  />
                </UTooltip>
                <UTooltip text="Edit site">
                  <UButton
                    icon="i-lucide-pencil"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    class="opacity-0 group-hover:opacity-100"
                    @click="openEditDialog(site)"
                  />
                </UTooltip>
                <UTooltip text="Delete site">
                  <UButton
                    icon="i-lucide-trash-2"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    class="opacity-0 group-hover:opacity-100"
                    @click="deleteTarget = site"
                  />
                </UTooltip>
              </li>
            </ul>
          </div>
        </template>
      </UCard>

      <UCard>
        <template #header>
          <h1 class="text-base font-medium text-highlighted">Quick Connect</h1>
        </template>

        <div class="flex flex-col gap-3">
          <UFormField label="Host">
            <UInput v-model="form.host" placeholder="example.com" class="w-full" />
          </UFormField>
          <UFormField label="Port">
            <UInput v-model.number="form.port" type="number" class="w-full" />
          </UFormField>
          <UFormField label="Username">
            <UInput v-model="form.username" class="w-full" />
          </UFormField>
          <UFormField label="Password">
            <UInput v-model="form.password" type="password" class="w-full" />
          </UFormField>

          <UAlert
            v-if="sessions.status === 'error'"
            color="error"
            variant="soft"
            :title="sessions.statusMessage ?? 'Connection failed'"
          />
        </div>

        <template #footer>
          <UButton block :loading="sessions.connecting" @click="onConnect">Connect</UButton>
        </template>
      </UCard>

      <p v-if="version" class="text-center text-[11px] text-muted">Ferry v{{ version }}</p>
    </div>

    <SiteFormDialog v-model:open="formOpen" :site="editingSite" />
    <ImportSessionsDialog v-model:open="importOpen" />

    <UModal
      :open="Boolean(deleteTarget)"
      title="Delete site"
      :ui="{ footer: 'justify-end' }"
      @update:open="(v: boolean) => { if (!v) deleteTarget = null }"
    >
      <template #body>
        <p class="text-sm text-default">
          Delete <span class="font-medium">{{ deleteTarget?.name }}</span>? This cannot be undone.
        </p>
      </template>
      <template #footer>
        <UButton color="neutral" variant="outline" @click="deleteTarget = null">Cancel</UButton>
        <UButton color="error" :loading="deleting" @click="confirmDelete">Delete</UButton>
      </template>
    </UModal>

    <UModal
      :open="Boolean(sessions.pendingHostKeyMismatch)"
      title="Host key changed"
      :ui="{ footer: 'justify-end' }"
      @update:open="(v: boolean) => { if (!v) sessions.dismissHostKeyMismatch(sessions.activeTabId) }"
    >
      <template #body>
        <div class="flex flex-col gap-3">
          <UAlert
            color="warning"
            variant="soft"
            icon="i-lucide-shield-alert"
            title="This could mean a man-in-the-middle attack"
          />
          <p class="text-sm text-default">{{ sessions.pendingHostKeyMismatch?.message }}</p>
          <p class="text-xs text-muted">
            Only continue if you're certain the change is legitimate — e.g. the server was reinstalled or its key was
            deliberately rotated.
          </p>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="outline" @click="sessions.dismissHostKeyMismatch(sessions.activeTabId)">
          Cancel
        </UButton>
        <UButton
          color="warning"
          :loading="sessions.connecting"
          @click="sessions.acceptHostKeyAndRetry(sessions.activeTabId)"
        >
          Trust new key &amp; connect
        </UButton>
      </template>
    </UModal>

    <UModal
      :open="Boolean(sessions.pendingKeyboardPrompt)"
      title="Authentication required"
      :ui="{ footer: 'justify-end' }"
      @update:open="(v: boolean) => { if (!v) sessions.cancelKeyboardInteractive() }"
    >
      <template #body>
        <div class="flex flex-col gap-3">
          <p v-if="sessions.pendingKeyboardPrompt?.instructions" class="text-sm text-default">
            {{ sessions.pendingKeyboardPrompt.instructions }}
          </p>
          <UFormField
            v-for="(prompt, i) in sessions.pendingKeyboardPrompt?.prompts ?? []"
            :key="i"
            :label="prompt.prompt"
          >
            <UInput
              v-model="keyboardAnswers[i]"
              :type="prompt.echo ? 'text' : 'password'"
              class="w-full"
              autofocus
              @keyup.enter="submitKeyboardAnswers"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="outline" @click="sessions.cancelKeyboardInteractive">Cancel</UButton>
        <UButton @click="submitKeyboardAnswers">Submit</UButton>
      </template>
    </UModal>
  </div>
</template>
