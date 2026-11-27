<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { FileDiffHunk, FileDiffLine, FileDiffResult } from '@shared/contract'
import { invoke } from '../../api'
import { formatBytes } from '../../utils/format'

interface SplitRow {
  left: FileDiffLine | null
  right: FileDiffLine | null
}

const props = withDefaults(
  defineProps<{
    open: boolean
    sessionId: string | null
    localPath: string | null
    remotePath: string | null
    localLabel?: string
    remoteLabel?: string
    localContent?: string
    viaSudo?: boolean
  }>(),
  {
    localLabel: 'Local',
    remoteLabel: 'Remote'
  }
)

const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const viewMode = ref<'unified' | 'split'>('unified')
const loading = ref(false)
const error = ref<string | null>(null)
const result = shallowRef<FileDiffResult | null>(null)
let loadToken = 0

function hunkHeader(hunk: FileDiffHunk): string {
  return `@@ -${hunk.localStart},${hunk.localCount} +${hunk.remoteStart},${hunk.remoteCount} @@`
}

function buildSplitRows(lines: FileDiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.kind === 'context') {
      rows.push({ left: line, right: line })
      i++
      continue
    }
    const removes: FileDiffLine[] = []
    const adds: FileDiffLine[] = []
    while (i < lines.length && lines[i].kind === 'remove') {
      removes.push(lines[i])
      i++
    }
    while (i < lines.length && lines[i].kind === 'add') {
      adds.push(lines[i])
      i++
    }
    const count = Math.max(removes.length, adds.length)
    for (let j = 0; j < count; j++) {
      rows.push({ left: removes[j] ?? null, right: adds[j] ?? null })
    }
  }
  return rows
}

const splitHunks = computed(() =>
  (result.value?.hunks ?? []).map((hunk) => ({
    header: hunkHeader(hunk),
    rows: buildSplitRows(hunk.lines)
  }))
)

async function loadDiff(): Promise<void> {
  const token = ++loadToken
  if (!props.open || !props.sessionId || !props.localPath || !props.remotePath) {
    loading.value = false
    error.value = null
    result.value = null
    return
  }
  loading.value = true
  error.value = null
  result.value = null
  try {
    const payload: {
      sessionId: string
      localPath: string
      remotePath: string
      localContent?: string
      viaSudo?: boolean
    } = {
      sessionId: props.sessionId,
      localPath: props.localPath,
      remotePath: props.remotePath
    }
    if (props.localContent !== undefined) {
      payload.localContent = props.localContent
    }
    if (props.viaSudo) {
      payload.viaSudo = true
    }
    const res = await invoke<FileDiffResult>(INVOKE_CHANNELS.syncDiffFiles, payload)
    if (token !== loadToken || !props.open) return
    result.value = res
  } catch (e) {
    if (token !== loadToken || !props.open) return
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (token === loadToken) {
      loading.value = false
    }
  }
}

watch(
  () => [props.open, props.sessionId, props.localPath, props.remotePath, props.localContent, props.viaSudo] as const,
  () => {
    void loadDiff()
  },
  { immediate: true }
)

const modalTitle = computed(() => {
  const target = props.remotePath ?? props.localPath ?? ''
  const name = target.split(/[\\/]/).pop() || target
  return name ? `Diff: ${name}` : 'File diff'
})

function lineBgClass(kind: FileDiffLine['kind']): string {
  if (kind === 'add') return 'bg-success/10 text-success'
  if (kind === 'remove') return 'bg-error/10 text-error'
  return 'text-default'
}

function linePrefix(kind: FileDiffLine['kind']): string {
  if (kind === 'add') return '+'
  if (kind === 'remove') return '-'
  return ' '
}
</script>

<template>
  <UModal
    :open="open"
    :title="modalTitle"
    :ui="{
      overlay: 'z-[60]',
      content: 'z-[60] sm:max-w-5xl h-[85vh] flex flex-col',
      body: 'p-0 sm:p-0 flex-1 overflow-hidden flex flex-col',
      header: 'py-3',
      footer: 'justify-end'
    }"
    @update:open="(v: boolean) => { if (!v) emit('update:open', false) }"
  >
    <template #actions>
      <template v-if="result && !result.skipped">
        <UBadge v-if="result.identical" color="neutral" variant="subtle" size="sm">Identical</UBadge>
        <template v-else>
          <UBadge color="success" variant="subtle" size="sm">+{{ result.additions }}</UBadge>
          <UBadge color="error" variant="subtle" size="sm">-{{ result.deletions }}</UBadge>
        </template>
      </template>
      <div class="flex items-center rounded-md border border-default p-0.5">
        <UButton
          size="xs"
          color="neutral"
          :variant="viewMode === 'unified' ? 'soft' : 'ghost'"
          :aria-pressed="viewMode === 'unified'"
          @click="viewMode = 'unified'"
        >
          Unified
        </UButton>
        <UButton
          size="xs"
          color="neutral"
          :variant="viewMode === 'split' ? 'soft' : 'ghost'"
          :aria-pressed="viewMode === 'split'"
          @click="viewMode = 'split'"
        >
          Side-by-side
        </UButton>
      </div>
      <UTooltip text="Refresh diff">
        <UButton
          icon="i-lucide-refresh-cw"
          size="xs"
          color="neutral"
          variant="ghost"
          aria-label="Refresh diff"
          :loading="loading"
          @click="loadDiff"
        />
      </UTooltip>
    </template>

    <template #body>
      <div class="grid grid-cols-2 gap-3 border-b border-default bg-muted/40 px-4 py-2 text-xs">
        <div class="min-w-0">
          <span class="font-medium text-muted">{{ localLabel }}:</span>
          <span class="ml-1.5 inline-block max-w-full truncate align-bottom font-mono text-default" :title="localPath ?? ''">
            {{ localPath }}
          </span>
        </div>
        <div class="min-w-0">
          <span class="font-medium text-muted">{{ remoteLabel }}:</span>
          <span class="ml-1.5 inline-block max-w-full truncate align-bottom font-mono text-default" :title="remotePath ?? ''">
            {{ remotePath }}
          </span>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-auto p-4">
        <div v-if="loading" role="status" aria-label="Loading file diff" class="flex flex-col gap-2.5">
          <USkeleton v-for="i in 8" :key="i" class="h-3.5" :style="{ width: `${45 + ((i * 23) % 45)}%` }" />
        </div>

        <UAlert v-else-if="error" color="error" variant="soft" :title="error" />

        <div v-else-if="result?.skipped" class="flex flex-col gap-3">
          <UAlert
            color="warning"
            variant="soft"
            icon="i-lucide-file-warning"
            :title="result.skipped.reason === 'binary' ? 'Binary file cannot be diffed' : 'File too large to diff'"
            :description="result.skipped.message"
          />
          <div class="rounded-md border border-default bg-muted/30 px-3 py-2 text-xs text-muted">
            {{ localLabel }} size: {{ formatBytes(result.localSize) }} ·
            {{ remoteLabel }} size: {{ formatBytes(result.remoteSize) }} ·
            Limit: {{ formatBytes(result.maxBytes) }}
          </div>
        </div>

        <div v-else-if="result?.identical" class="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
          <UIcon name="i-lucide-check-circle-2" class="size-8 text-success" />
          <p class="text-sm font-medium text-default">Files are identical</p>
          <p class="text-xs text-muted">No line differences found between {{ localLabel }} and {{ remoteLabel }}.</p>
        </div>

        <div v-else-if="result" class="flex flex-col gap-3">
          <UAlert
            v-if="result.simplified"
            color="warning"
            variant="soft"
            title="Large diff simplified"
            :description="result.omittedLines
              ? `Too many changed lines for full line-by-line alignment; showing the first 250 changed lines per side (${result.omittedLines} lines omitted).`
              : 'Too many changed lines for full line-by-line alignment; showing block differences.'"
          />

          <div v-if="viewMode === 'unified'" class="overflow-x-auto rounded-md border border-default font-mono text-xs">
            <template v-for="(hunk, hi) in result.hunks" :key="hi">
              <div class="border-y border-default bg-muted/60 px-3 py-1 text-[11px] text-muted first:border-t-0">
                {{ hunkHeader(hunk) }}
              </div>
              <div
                v-for="(line, li) in hunk.lines"
                :key="`${hi}-${li}`"
                class="flex min-w-max leading-5"
                :class="lineBgClass(line.kind)"
              >
                <span class="w-11 shrink-0 select-none border-r border-default/40 px-1.5 text-right tabular-nums text-muted">
                  {{ line.localLine ?? '' }}
                </span>
                <span class="w-11 shrink-0 select-none border-r border-default/40 px-1.5 text-right tabular-nums text-muted">
                  {{ line.remoteLine ?? '' }}
                </span>
                <span class="w-5 shrink-0 select-none text-center">{{ linePrefix(line.kind) }}</span>
                <span class="whitespace-pre pr-3">{{ line.text }}</span>
              </div>
            </template>
          </div>

          <div v-else class="overflow-x-auto rounded-md border border-default font-mono text-xs">
            <template v-for="(hunk, hi) in splitHunks" :key="hi">
              <div class="border-y border-default bg-muted/60 px-3 py-1 text-[11px] text-muted first:border-t-0">
                {{ hunk.header }}
              </div>
              <div
                v-for="(row, ri) in hunk.rows"
                :key="`${hi}-${ri}`"
                class="grid min-w-[44rem] grid-cols-2 divide-x divide-default leading-5"
              >
                <div
                  class="flex min-w-0"
                  :class="row.left ? (row.left.kind === 'remove' ? 'bg-error/10 text-error' : 'text-default') : 'bg-muted/20'"
                >
                  <span class="w-11 shrink-0 select-none border-r border-default/40 px-1.5 text-right tabular-nums text-muted">
                    {{ row.left?.localLine ?? '' }}
                  </span>
                  <span class="w-5 shrink-0 select-none text-center">
                    {{ row.left?.kind === 'remove' ? '-' : ' ' }}
                  </span>
                  <span class="min-w-0 flex-1 whitespace-pre-wrap break-all pr-2">{{ row.left?.text ?? '' }}</span>
                </div>
                <div
                  class="flex min-w-0"
                  :class="row.right ? (row.right.kind === 'add' ? 'bg-success/10 text-success' : 'text-default') : 'bg-muted/20'"
                >
                  <span class="w-11 shrink-0 select-none border-r border-default/40 px-1.5 text-right tabular-nums text-muted">
                    {{ row.right?.remoteLine ?? '' }}
                  </span>
                  <span class="w-5 shrink-0 select-none text-center">
                    {{ row.right?.kind === 'add' ? '+' : ' ' }}
                  </span>
                  <span class="min-w-0 flex-1 whitespace-pre-wrap break-all pr-2">{{ row.right?.text ?? '' }}</span>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <slot name="footer" />
      <UButton color="neutral" variant="outline" @click="emit('update:open', false)">Close</UButton>
    </template>
  </UModal>
</template>
