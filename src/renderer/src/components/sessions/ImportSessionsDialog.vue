<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { ImportedSessionCandidate, SiteInput } from '@shared/contract'
import { useSitesStore } from '../../stores/sites.store'
// Not yet in the auto-generated global components.d.ts — deep-import instead
// of relying on <UCheckbox> (see ChmodDialog.vue/FileRow.vue for the same pattern).
import UCheckbox from '@nuxt/ui/components/Checkbox.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const sites = useSitesStore()
const loading = ref(false)
const scanned = ref<ImportedSessionCandidate[]>([])
const selected = reactive(new Set<number>())
const importing = ref(false)
const error = ref<string | null>(null)

const GROUP_LABELS = {
  winscp: 'Imported from WinSCP',
  putty: 'Imported from PuTTY',
  sshconfig: 'Imported from ~/.ssh/config'
} as const

/** host:port:username identifies "the same connection" for dedup — matches how a human would recognize a duplicate. */
function key(host: string, port: number, username: string): string {
  return `${host.toLowerCase()}:${port}:${username.toLowerCase()}`
}

const existingKeys = computed(() => new Set(sites.sites.map((s) => key(s.host, s.port, s.username))))

const rows = computed(() =>
  scanned.value.map((candidate, index) => ({
    candidate,
    index,
    alreadySaved: existingKeys.value.has(key(candidate.host, candidate.port, candidate.username))
  }))
)

const selectableRows = computed(() => rows.value.filter((r) => !r.alreadySaved))
const selectableCount = computed(() => selectableRows.value.length)
const allSelected = computed(() => selectableCount.value > 0 && selectableRows.value.every((r) => selected.has(r.index)))

function toggleSelectAll(): void {
  if (allSelected.value) {
    selected.clear()
  } else {
    for (const r of selectableRows.value) {
      selected.add(r.index)
    }
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      return
    }
    error.value = null
    selected.clear()
    loading.value = true
    try {
      scanned.value = await sites.scanImportCandidates()
      rows.value.forEach((r) => {
        if (!r.alreadySaved) {
          selected.add(r.index)
        }
      })
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)

function toggle(index: number, checked: boolean | 'indeterminate'): void {
  if (checked === true) {
    selected.add(index)
  } else {
    selected.delete(index)
  }
}

function close(): void {
  emit('update:open', false)
}

async function importSelected(): Promise<void> {
  importing.value = true
  error.value = null
  const targets = rows.value.filter((r) => selected.has(r.index))
  try {
    for (const { candidate, index } of targets) {
      const input: SiteInput = {
        name: candidate.name,
        host: candidate.host,
        port: candidate.port,
        username: candidate.username,
        authMethod: candidate.privateKeyPath ? 'privateKey' : 'password',
        privateKeyPath: candidate.privateKeyPath,
        remoteInitialPath: candidate.remoteInitialPath,
        jumpHosts: candidate.jumpHosts,
        group: GROUP_LABELS[candidate.source]
      }
      await sites.createSiteWithoutRefetch(input)
      // Prune as each import succeeds, so retrying after a later failure
      // doesn't re-create the ones that already went through.
      selected.delete(index)
    }
    close()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    await sites.fetchSites()
    importing.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :dismissible="!importing"
    :close="!importing"
    title="Import sites"
    description="Scans this machine's saved WinSCP and PuTTY sessions (Windows) and ~/.ssh/config."
    :ui="{ footer: 'flex-wrap justify-end', content: 'max-w-lg' }"
    @update:open="(v: boolean) => { if (!v && !importing) close() }"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <UAlert
          color="info"
          variant="soft"
          icon="i-lucide-info"
          title="Passwords aren't imported"
          description="WinSCP/PuTTY don't store passwords in a form Ferry can safely decode. Set one after import if the site needs it."
        />

        <div v-if="loading" role="status" aria-live="polite" class="py-4 text-center text-xs text-muted">
          Scanning for saved sessions…
        </div>
        <div v-else-if="scanned.length === 0" role="status" aria-live="polite" class="py-4 text-center text-xs text-muted">
          No WinSCP, PuTTY or ~/.ssh/config sessions found on this machine.
        </div>
        <template v-else>
          <div v-if="selectableCount > 0" class="flex items-center justify-between text-xs text-muted">
            <span role="status" aria-live="polite">{{ selected.size }} of {{ selectableCount }} ready to import</span>
            <UButton
              :label="allSelected ? 'Deselect all' : 'Select all'"
              size="xs"
              color="neutral"
              variant="ghost"
              @click="toggleSelectAll"
            />
          </div>
          <ul class="flex max-h-80 flex-col gap-1 overflow-y-auto">
            <li
              v-for="row in rows"
              :key="row.index"
              class="flex items-center gap-2 rounded-md px-2 py-1.5"
              :class="row.alreadySaved ? 'opacity-50' : 'cursor-pointer hover:bg-muted'"
              @click="!row.alreadySaved && toggle(row.index, !selected.has(row.index))"
            >
              <UCheckbox
                :model-value="selected.has(row.index)"
                :disabled="row.alreadySaved"
                :aria-label="`Select ${row.candidate.name}`"
                @click.stop
                @update:model-value="(v: boolean | 'indeterminate') => toggle(row.index, v)"
              />
              <UBadge color="neutral" variant="subtle" size="sm">{{ row.candidate.source }}</UBadge>
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-highlighted">{{ row.candidate.name }}</div>
                <div class="truncate text-xs text-muted">
                  {{ row.candidate.username }}@{{ row.candidate.host }}:{{ row.candidate.port }}
                  <span v-if="row.alreadySaved">(already saved)</span>
                </div>
              </div>
            </li>
          </ul>
        </template>

        <UAlert v-if="error" role="alert" color="error" variant="soft" :title="error" />
      </div>
    </template>

    <template #footer>
      <UButton color="neutral" variant="outline" :disabled="importing" @click="close">Cancel</UButton>
      <UButton :loading="importing" :disabled="selected.size === 0 || selectableCount === 0" @click="importSelected">
        Import {{ selected.size }} selected
      </UButton>
    </template>
  </UModal>
</template>
