<script setup lang="ts">
import { computed } from 'vue'
import { useNotify } from '../../composables/useNotify'
import {
  extractJsonPayload,
  getLogLevelStyles,
  parseTimestampPrefix,
  type LogLevel
} from '../../utils/logParser'

const props = defineProps<{
  lineNumber: number
  text: string
  level: LogLevel
  pinned: boolean
  hasPrev: boolean
  hasNext: boolean
}>()

const emit = defineEmits<{
  prev: []
  next: []
  togglePin: []
  close: []
}>()

const notify = useNotify()

const levelStyles = computed(() => getLogLevelStyles(props.level))
const tsParsed = computed(() => parseTimestampPrefix(props.text))
const jsonPayload = computed(() => extractJsonPayload(props.text))

const formattedJson = computed(() => {
  if (!jsonPayload.value) return ''
  try {
    return JSON.stringify(jsonPayload.value.data, null, 2)
  } catch {
    return jsonPayload.value.rawJson
  }
})

const MAX_FLAT_FIELDS = 40
const MAX_FLAT_DEPTH = 3

function flattenFields(
  value: unknown,
  prefix: string,
  depth: number,
  out: Array<{ key: string; value: string }>
): void {
  if (out.length >= MAX_FLAT_FIELDS) return
  if (value === null || typeof value !== 'object') {
    out.push({ key: prefix, value: String(value) })
    return
  }
  if (depth >= MAX_FLAT_DEPTH) {
    out.push({ key: prefix, value: JSON.stringify(value) })
    return
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push({ key: prefix, value: '[]' })
      return
    }
    const limit = Math.min(value.length, 5)
    for (let i = 0; i < limit && out.length < MAX_FLAT_FIELDS; i++) {
      flattenFields(value[i], `${prefix}[${i}]`, depth + 1, out)
    }
    if (value.length > limit && out.length < MAX_FLAT_FIELDS) {
      out.push({ key: `${prefix}[…]`, value: `${value.length - limit} more items` })
    }
    return
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) {
    out.push({ key: prefix, value: '{}' })
    return
  }
  for (const [k, v] of entries) {
    if (out.length >= MAX_FLAT_FIELDS) break
    flattenFields(v, prefix ? `${prefix}.${k}` : k, depth + 1, out)
  }
}

const jsonFields = computed<Array<{ key: string; value: string }>>(() => {
  const data = jsonPayload.value?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return []
  }
  const out: Array<{ key: string; value: string }> = []
  flattenFields(data, '', 0, out)
  return out
})

async function copyValue(value: string, label = 'Copied to clipboard'): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    notify.success(label)
  } catch (e) {
    notify.error('Copy failed', e instanceof Error ? e.message : String(e))
  }
}
</script>

<template>
  <aside
    aria-label="Log line inspector"
    class="absolute inset-y-0 right-0 z-30 flex w-80 max-w-[90%] flex-col overflow-hidden border-l border-muted bg-default shadow-xl lg:w-96"
  >
    <!-- Inspector Header -->
    <div class="flex h-8 shrink-0 items-center justify-between border-b border-muted bg-muted/30 px-2.5 select-none">
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="font-mono text-xs font-semibold text-default tabular-nums">Line #{{ lineNumber }}</span>
        <span
          v-if="levelStyles.badgeText"
          class="inline-block rounded px-1 py-0.2 text-2xs font-bold leading-none"
          :class="levelStyles.badgeClass"
        >
          {{ levelStyles.badgeText }}
        </span>
        <span
          v-if="jsonPayload"
          class="inline-block rounded bg-primary/10 px-1 py-0.2 font-mono text-[10px] font-semibold text-primary ring-1 ring-primary/20"
        >
          JSON
        </span>
      </div>

      <div class="flex items-center gap-0.5 shrink-0">
        <UTooltip text="Previous line (↑)">
          <UButton
            aria-label="Previous line"
            icon="i-lucide-chevron-up"
            size="xs"
            color="neutral"
            variant="ghost"
            :disabled="!hasPrev"
            @click="emit('prev')"
          />
        </UTooltip>
        <UTooltip text="Next line (↓)">
          <UButton
            aria-label="Next line"
            icon="i-lucide-chevron-down"
            size="xs"
            color="neutral"
            variant="ghost"
            :disabled="!hasNext"
            @click="emit('next')"
          />
        </UTooltip>
        <UTooltip :text="pinned ? 'Unpin line' : 'Pin line'">
          <UButton
            :aria-label="pinned ? 'Unpin line' : 'Pin line'"
            icon="i-lucide-bookmark"
            size="xs"
            :color="pinned ? 'primary' : 'neutral'"
            :variant="pinned ? 'soft' : 'ghost'"
            @click="emit('togglePin')"
          />
        </UTooltip>
        <UTooltip text="Copy raw line">
          <UButton
            aria-label="Copy raw line"
            icon="i-lucide-copy"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="copyValue(text, 'Line copied')"
          />
        </UTooltip>
        <UTooltip text="Close inspector (Esc)">
          <UButton
            aria-label="Close inspector"
            icon="i-lucide-x"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="emit('close')"
          />
        </UTooltip>
      </div>
    </div>

    <!-- Inspector Body -->
    <div class="min-h-0 flex-1 overflow-y-auto p-3 space-y-3 text-xs">
      <!-- Metadata Strip -->
      <div class="flex flex-wrap items-center gap-2 rounded-md border border-muted bg-muted/20 px-2.5 py-1.5 text-2xs">
        <div v-if="tsParsed.timestamp" class="flex items-center gap-1 min-w-0">
          <UIcon name="i-lucide-clock" class="size-3 shrink-0 text-muted" />
          <span class="font-mono text-default truncate select-text">{{ tsParsed.timestamp }}</span>
        </div>
        <span v-if="tsParsed.timestamp" class="text-dimmed">•</span>
        <span class="font-mono text-muted tabular-nums">{{ text.length.toLocaleString() }} chars</span>
      </div>

      <!-- Extracted Prefix (if line has text before JSON) -->
      <div v-if="jsonPayload && jsonPayload.prefix" class="space-y-1">
        <div class="text-2xs font-medium uppercase tracking-wider text-muted">Message</div>
        <div class="rounded-md border border-muted bg-muted/20 px-2.5 py-1.5 font-mono text-2xs text-default break-words select-text">
          {{ jsonPayload.prefix }}
        </div>
      </div>

      <!-- Structured JSON Fields -->
      <div v-if="jsonFields.length > 0" class="space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="text-2xs font-medium uppercase tracking-wider text-muted">Fields ({{ jsonFields.length }})</span>
          <span class="text-[10px] text-muted">Click value to copy</span>
        </div>
        <div class="divide-y divide-muted rounded-md border border-muted overflow-hidden">
          <div
            v-for="field in jsonFields"
            :key="field.key"
            class="flex items-start gap-2 px-2.5 py-1.5 hover:bg-muted/30 transition-colors"
          >
            <span class="w-32 shrink-0 truncate font-mono text-2xs text-muted select-text" :title="field.key">
              {{ field.key }}
            </span>
            <button
              type="button"
              class="min-w-0 flex-1 text-left font-mono text-2xs text-default break-all hover:text-primary cursor-pointer transition-colors"
              title="Copy value"
              @click="copyValue(field.value, `Copied ${field.key}`)"
            >
              {{ field.value }}
            </button>
          </div>
        </div>
      </div>

      <!-- Pretty-Printed JSON -->
      <div v-if="jsonPayload" class="space-y-1">
        <div class="flex items-center justify-between">
          <span class="text-2xs font-medium uppercase tracking-wider text-muted">JSON Payload</span>
          <UButton
            label="Copy JSON"
            icon="i-lucide-copy"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="copyValue(formattedJson, 'Formatted JSON copied')"
          />
        </div>
        <pre class="overflow-x-auto rounded-md border border-muted bg-muted/40 p-2.5 font-mono text-2xs leading-relaxed text-default select-text">{{ formattedJson }}</pre>
      </div>

      <!-- Raw Line -->
      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <span class="text-2xs font-medium uppercase tracking-wider text-muted">Raw Line</span>
        </div>
        <div class="rounded-md border border-muted bg-muted/20 p-2.5 font-mono text-2xs leading-relaxed text-default whitespace-pre-wrap break-all select-text">
          {{ text }}
        </div>
      </div>
    </div>
  </aside>
</template>
