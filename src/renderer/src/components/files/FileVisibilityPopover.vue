<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import Popover from '@nuxt/ui/components/Popover.vue'
import {
  appendUniquePattern,
  formatPatternLines,
  hasActiveVisibilityFilter,
  parsePatternLines,
  suggestPatternsFromFilename,
  type FileVisibilityFilter
} from '../../utils/fileVisibilityFilter'

const props = defineProps<{
  modelValue: FileVisibilityFilter
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [filter: FileVisibilityFilter]
  clear: []
}>()

const open = ref(false)
const sampleFilename = ref('')
const includeDraft = ref(formatPatternLines(props.modelValue.include))
const excludeDraft = ref(formatPatternLines(props.modelValue.exclude))

const helperId = useId()
const includeId = useId()
const excludeId = useId()
const syntaxHelpId = useId()

const activeRuleCount = computed(
  () => props.modelValue.include.length + props.modelValue.exclude.length
)
const isActive = computed(() => hasActiveVisibilityFilter(props.modelValue))
const suggestions = computed(() => suggestPatternsFromFilename(sampleFilename.value))

const triggerTooltip = computed(() => {
  if (!isActive.value) return 'Filter files by filename pattern'
  const parts: string[] = []
  if (props.modelValue.include.length > 0) parts.push(`${props.modelValue.include.length} include`)
  if (props.modelValue.exclude.length > 0) parts.push(`${props.modelValue.exclude.length} exclude`)
  return `File visibility filters active (${parts.join(', ')})`
})

function samePatterns(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

watch(
  () => props.modelValue,
  (next) => {
    // Only sync drafts from external changes (e.g. tab switch or Clear filters) so trailing newlines aren't eaten mid-typing.
    if (!samePatterns(parsePatternLines(includeDraft.value), next.include)) {
      includeDraft.value = formatPatternLines(next.include)
    }
    if (!samePatterns(parsePatternLines(excludeDraft.value), next.exclude)) {
      excludeDraft.value = formatPatternLines(next.exclude)
    }
  },
  { deep: true }
)

function emitUpdated(include: string[], exclude: string[]): void {
  emit('update:modelValue', { include, exclude })
}

function onIncludeInput(value: string): void {
  includeDraft.value = value
  emitUpdated(parsePatternLines(value), [...props.modelValue.exclude])
}

function onExcludeInput(value: string): void {
  excludeDraft.value = value
  emitUpdated([...props.modelValue.include], parsePatternLines(value))
}

function addSuggestedPattern(mode: 'include' | 'exclude', pattern: string): void {
  if (mode === 'include') {
    const next = appendUniquePattern(props.modelValue.include, pattern)
    includeDraft.value = formatPatternLines(next)
    emitUpdated(next, [...props.modelValue.exclude])
  } else {
    const next = appendUniquePattern(props.modelValue.exclude, pattern)
    excludeDraft.value = formatPatternLines(next)
    emitUpdated([...props.modelValue.include], next)
  }
}

function onClear(): void {
  includeDraft.value = ''
  excludeDraft.value = ''
  sampleFilename.value = ''
  emit('clear')
}
</script>

<template>
  <Popover v-model:open="open">
    <UTooltip :text="triggerTooltip">
      <UButton
        icon="i-lucide-filter"
        :color="isActive ? 'primary' : 'neutral'"
        :variant="isActive ? 'soft' : 'ghost'"
        size="xs"
        :disabled="disabled"
        aria-label="Filter files"
        aria-haspopup="dialog"
        :aria-expanded="open"
      >
        <span v-if="isActive" class="text-2xs font-semibold tabular-nums">{{ activeRuleCount }}</span>
      </UButton>
    </UTooltip>
    <template #content>
      <div class="flex w-88 max-w-[90vw] flex-col gap-3 p-3">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-xs font-semibold text-highlighted">File visibility filters</h3>
          <UButton
            type="button"
            size="xs"
            color="neutral"
            variant="ghost"
            :disabled="!isActive"
            @click="onClear"
          >
            Clear filters
          </UButton>
        </div>

        <p :id="syntaxHelpId" class="text-2xs leading-relaxed text-muted">
          Case-sensitive basename globs (<code class="rounded bg-muted px-1 font-mono">*</code> any chars,
          <code class="rounded bg-muted px-1 font-mono">?</code> single char). One pattern per line. Directories stay
          visible; excludes win.
        </p>

        <div class="flex flex-col gap-1.5 rounded-md border border-muted bg-muted/25 p-2">
          <label :for="helperId" class="text-2xs font-medium text-default">
            Pattern helper (paste a filename)
          </label>
          <UInput
            :id="helperId"
            v-model="sampleFilename"
            size="xs"
            placeholder="e.g. app.log.2026-06-17"
            autocorrect="off"
            autocapitalize="none"
            spellcheck="false"
          />
          <ul v-if="suggestions.length > 0" class="flex flex-col gap-1 pt-0.5">
            <li
              v-for="item in suggestions"
              :key="item.pattern"
              class="flex items-center justify-between gap-1.5 rounded px-1.5 py-1 text-2xs hover:bg-muted/60"
            >
              <div class="min-w-0 flex-1">
                <code class="block truncate font-mono text-highlighted" :title="item.pattern">{{ item.pattern }}</code>
                <span class="block truncate text-muted">{{ item.label }}</span>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <UButton
                  type="button"
                  size="xs"
                  color="neutral"
                  variant="soft"
                  :aria-label="`+ Include ${item.pattern}`"
                  @click="addSuggestedPattern('include', item.pattern)"
                >
                  + Include
                </UButton>
                <UButton
                  type="button"
                  size="xs"
                  color="neutral"
                  variant="soft"
                  :aria-label="`+ Exclude ${item.pattern}`"
                  @click="addSuggestedPattern('exclude', item.pattern)"
                >
                  + Exclude
                </UButton>
              </div>
            </li>
          </ul>
        </div>

        <div class="flex flex-col gap-1">
          <label :for="includeId" class="text-2xs font-medium text-default">
            Show only matching (include)
          </label>
          <UTextarea
            :id="includeId"
            :model-value="includeDraft"
            :rows="3"
            size="xs"
            class="font-mono"
            placeholder="*.log"
            :aria-describedby="syntaxHelpId"
            autocorrect="off"
            autocapitalize="none"
            spellcheck="false"
            @update:model-value="onIncludeInput"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label :for="excludeId" class="text-2xs font-medium text-default">
            Hide matching (exclude)
          </label>
          <UTextarea
            :id="excludeId"
            :model-value="excludeDraft"
            :rows="3"
            size="xs"
            class="font-mono"
            placeholder="*.log.????-??-??"
            :aria-describedby="syntaxHelpId"
            autocorrect="off"
            autocapitalize="none"
            spellcheck="false"
            @update:model-value="onExcludeInput"
          />
        </div>
      </div>
    </template>
  </Popover>
</template>
