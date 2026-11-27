<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { INVOKE_CHANNELS, type ExportSshConfigResult } from '@shared/contract'
import { invoke } from '../../api'
import { useSitesStore } from '../../stores/sites.store'
import { useNotify } from '../../composables/useNotify'
// Not yet in the auto-generated global components.d.ts — deep-import instead
// of relying on <UCheckbox> (see ImportSessionsDialog.vue for the same pattern).
import UCheckbox from '@nuxt/ui/components/Checkbox.vue'

const props = defineProps<{
  open: boolean
  initialSiteIds?: string[]
}>()

const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const sites = useSitesStore()
const notify = useNotify()

const selected = reactive(new Set<string>())
const loading = ref(false)
const saving = ref(false)
const copied = ref(false)
const error = ref<string | null>(null)
const exportResult = ref<ExportSshConfigResult | null>(null)

let requestSeq = 0
let copiedTimer: ReturnType<typeof setTimeout> | null = null

const allSites = computed(() => sites.sites)
const allSelected = computed(
  () => allSites.value.length > 0 && allSites.value.every((s) => selected.has(s.id))
)
const previewContent = computed(() => exportResult.value?.content ?? '')
const hasExportableContent = computed(() => (exportResult.value?.exportedCount ?? 0) > 0)

function clearCopiedState(): void {
  if (copiedTimer !== null) {
    clearTimeout(copiedTimer)
    copiedTimer = null
  }
  copied.value = false
}

async function refreshPreview(): Promise<void> {
  const seq = ++requestSeq
  clearCopiedState()

  if (selected.size === 0) {
    exportResult.value = { content: '', exportedCount: 0, skippedCount: 0 }
    error.value = null
    loading.value = false
    return
  }

  loading.value = true
  error.value = null
  try {
    const res = await sites.exportSshConfig({
      siteIds: Array.from(selected),
      includeHeader: true
    })
    if (seq !== requestSeq) return
    exportResult.value = res
  } catch (e) {
    if (seq !== requestSeq) return
    exportResult.value = null
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (seq === requestSeq) {
      loading.value = false
    }
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      clearCopiedState()
      return
    }
    error.value = null
    selected.clear()
    const validIds = new Set(allSites.value.map((s) => s.id))
    const initial = (props.initialSiteIds ?? []).filter((id) => validIds.has(id))
    if (initial.length > 0) {
      for (const id of initial) {
        selected.add(id)
      }
    } else {
      for (const s of allSites.value) {
        selected.add(s.id)
      }
    }
    void refreshPreview()
  },
  { immediate: true }
)

function toggle(id: string, checked: boolean | 'indeterminate'): void {
  if (checked === true) {
    selected.add(id)
  } else {
    selected.delete(id)
  }
  void refreshPreview()
}

function toggleSelectAll(): void {
  if (allSelected.value) {
    selected.clear()
  } else {
    for (const s of allSites.value) {
      selected.add(s.id)
    }
  }
  void refreshPreview()
}

function close(): void {
  emit('update:open', false)
}

async function onCopy(): Promise<void> {
  if (!hasExportableContent.value) return
  try {
    await navigator.clipboard.writeText(previewContent.value)
    clearCopiedState()
    copied.value = true
    copiedTimer = setTimeout(() => {
      copied.value = false
      copiedTimer = null
    }, 2000)
    notify.success(
      'OpenSSH config copied',
      `${exportResult.value?.exportedCount ?? 0} site${exportResult.value?.exportedCount === 1 ? '' : 's'} copied to clipboard`
    )
  } catch (e) {
    notify.error('Could not copy config', e instanceof Error ? e.message : String(e))
  }
}

async function onSave(): Promise<void> {
  if (!hasExportableContent.value || saving.value) return
  saving.value = true
  try {
    const content = previewContent.value
    const isDesktop = Boolean((window as { NL_ARGS?: unknown }).NL_ARGS)
    if (isDesktop) {
      const savePath = await invoke<string | null>(INVOKE_CHANNELS.dialogPickSaveFile, 'config')
      if (!savePath) return
      await invoke<void>(INVOKE_CHANNELS.fsLocalWriteFile, { path: savePath, content })
      notify.success('OpenSSH config saved', `Saved to ${savePath}`)
      return
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ssh_config'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    notify.success('OpenSSH config exported', 'Saved to ssh_config')
  } catch (e) {
    notify.error('Export failed', e instanceof Error ? e.message : String(e))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :dismissible="!saving"
    :close="!saving"
    title="Export as OpenSSH config"
    description="Generate standard ~/.ssh/config entries for selected saved sites."
    :ui="{ footer: 'flex-wrap justify-end', content: 'max-w-2xl' }"
    @update:open="(v: boolean) => { if (!v && !saving) close() }"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <UAlert
          color="info"
          variant="soft"
          icon="i-lucide-shield-check"
          title="Passwords and passphrases are never exported"
          description="Only non-secret connection details (Host, HostName, Port, User, IdentityFile, ProxyJump) are included."
        />

        <div v-if="allSites.length === 0" role="status" aria-live="polite" class="py-4 text-center text-xs text-muted">
          No saved sites available to export.
        </div>

        <template v-else>
          <div class="flex items-center justify-between text-xs text-muted">
            <span role="status" aria-live="polite">{{ selected.size }} of {{ allSites.length }} sites selected</span>
            <UButton
              :label="allSelected ? 'Deselect all' : 'Select all'"
              size="xs"
              color="neutral"
              variant="ghost"
              @click="toggleSelectAll"
            />
          </div>

          <ul class="flex max-h-44 flex-col gap-1 overflow-y-auto rounded-md border border-default/40 p-1.5">
            <li
              v-for="site in allSites"
              :key="site.id"
              class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
              @click="toggle(site.id, !selected.has(site.id))"
            >
              <UCheckbox
                :model-value="selected.has(site.id)"
                :aria-label="`Select ${site.name}`"
                @click.stop
                @update:model-value="(v: boolean | 'indeterminate') => toggle(site.id, v)"
              />
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-highlighted">{{ site.name }}</div>
                <div class="truncate text-xs text-muted">
                  {{ site.username }}@{{ site.host }}:{{ site.port }}
                </div>
              </div>
              <UBadge v-if="site.jumpHosts && site.jumpHosts.length > 0" color="neutral" variant="subtle" size="sm">
                {{ site.jumpHosts.length }} hop{{ site.jumpHosts.length === 1 ? '' : 's' }}
              </UBadge>
            </li>
          </ul>

          <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between text-xs text-muted">
              <span class="font-medium text-default">OpenSSH config preview</span>
              <span v-if="loading" role="status" aria-live="polite">Generating…</span>
              <span v-else-if="exportResult && exportResult.skippedCount > 0">
                {{ exportResult.skippedCount }} skipped (missing host)
              </span>
            </div>
            <pre
              data-testid="ssh-config-preview"
              class="max-h-60 overflow-auto rounded-md border border-default/40 bg-muted/40 p-3 font-mono text-xs leading-relaxed text-default select-all"
            >{{ hasExportableContent ? previewContent : '# Select at least one site to preview OpenSSH config.' }}</pre>
          </div>
        </template>

        <UAlert v-if="error" role="alert" color="error" variant="soft" :title="error" />
      </div>
    </template>

    <template #footer>
      <UButton color="neutral" variant="outline" :disabled="saving" @click="close">Close</UButton>
      <UButton
        color="neutral"
        variant="outline"
        :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
        :disabled="!hasExportableContent || loading"
        @click="onCopy"
      >
        {{ copied ? 'Copied' : 'Copy' }}
      </UButton>
      <UButton
        icon="i-lucide-save"
        :loading="saving"
        :disabled="!hasExportableContent || loading"
        @click="onSave"
      >
        Save config…
      </UButton>
    </template>
  </UModal>
</template>
