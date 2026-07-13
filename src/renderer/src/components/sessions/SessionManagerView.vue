<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { AppVersionResult, QuickConnectInput, Site } from '@shared/contract'
import { invoke } from '../../api'
import { useSessionsStore } from '../../stores/sessions.store'
import { useSitesStore } from '../../stores/sites.store'
import SiteFormDialog from './SiteFormDialog.vue'

const sessions = useSessionsStore()
const sites = useSitesStore()
const version = ref('')

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
</script>

<template>
  <div class="flex h-full items-center justify-center overflow-y-auto bg-default py-8">
    <div class="flex w-full max-w-sm flex-col gap-4">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h1 class="text-base font-medium text-highlighted">Sites</h1>
            <UButton icon="i-lucide-plus" size="xs" variant="soft" @click="openCreateDialog">Add site</UButton>
          </div>
        </template>

        <div v-if="sites.loading" class="py-4 text-center text-xs text-muted">Loading sites…</div>
        <div v-else-if="sites.sites.length === 0" class="py-4 text-center text-xs text-muted">
          No saved sites yet — add one, or use Quick Connect below.
        </div>
        <ul v-else class="flex flex-col gap-1">
          <li
            v-for="site in sites.sites"
            :key="site.id"
            class="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
          >
            <UIcon name="i-lucide-server" class="size-4 shrink-0 text-muted" />
            <button class="min-w-0 flex-1 text-left" @click="onConnectSite(site)">
              <div class="truncate text-sm font-medium text-highlighted">{{ site.name }}</div>
              <div class="truncate text-xs text-muted">{{ site.username }}@{{ site.host }}:{{ site.port }}</div>
            </button>
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
  </div>
</template>
