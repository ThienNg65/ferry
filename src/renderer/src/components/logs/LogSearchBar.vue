<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { KEYWORD_CLASSES } from '../../utils/keywordHighlight'

const props = defineProps<{
  modelValue: string
  matchCount: number
  currentMatch: number
  caseSensitive: boolean
  isRegex: boolean
  filterOnly?: boolean
  regexError?: string | null
  keywords?: string[]
  searchPending?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:caseSensitive': [value: boolean]
  'update:isRegex': [value: boolean]
  'update:filterOnly': [value: boolean]
  addKeyword: [keyword: string]
  removeKeyword: [index: number]
  clearKeywords: []
  next: []
  prev: []
  close: []
}>()

const keywordDraft = ref('')

function submitKeyword(): void {
  const value = keywordDraft.value.trim()
  if (value) {
    emit('addKeyword', value)
  }
  keywordDraft.value = ''
}

const rootRef = ref<HTMLDivElement | null>(null)
const inputRef = ref<{ inputRef?: HTMLInputElement } | HTMLInputElement | null>(null)

function focusInput(): void {
  void nextTick(() => {
    const el =
      inputRef.value && 'inputRef' in inputRef.value
        ? inputRef.value.inputRef
        : (inputRef.value as HTMLInputElement | null)
    if (el) {
      el.focus()
      el.select()
    }
  })
}

function clearQuery(): void {
  emit('update:modelValue', '')
  focusInput()
}

function contains(target: EventTarget | null): boolean {
  return target instanceof Node && (rootRef.value?.contains(target) ?? false)
}

defineExpose({
  focusInput,
  contains
})

// The bar is always visible now; the keyword row only shows once opened or populated.
const highlightOpen = ref(false)

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault()
    if (e.shiftKey) {
      emit('prev')
    } else {
      emit('next')
    }
  } else if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    focusInput()
  } else if (e.altKey && e.key.toLowerCase() === 'c') {
    e.preventDefault()
    emit('update:caseSensitive', !props.caseSensitive)
  } else if (e.altKey && e.key.toLowerCase() === 'r') {
    e.preventDefault()
    emit('update:isRegex', !props.isRegex)
  } else if (e.altKey && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    emit('update:filterOnly', !props.filterOnly)
  }
}
</script>

<template>
  <div
    ref="rootRef"
    class="flex flex-col gap-1.5 border-b border-muted bg-muted/70 px-2.5 py-1.5 text-xs backdrop-blur-sm"
  >
    <div class="flex items-center gap-1.5">
    <div class="relative flex min-w-[220px] max-w-sm flex-1 items-center">
      <UInput
        ref="inputRef"
        :model-value="modelValue"
        placeholder="Find or filter log (Ctrl+F)…"
        icon="i-lucide-search"
        size="xs"
        class="w-full"
        :color="regexError ? 'error' : 'neutral'"
        @update:model-value="emit('update:modelValue', String($event))"
        @keydown="onKeydown"
      />
      <button
        v-if="modelValue.length > 0"
        type="button"
        class="absolute right-2 text-muted hover:text-default transition-colors p-0.5 rounded cursor-pointer"
        title="Clear search"
        @click="clearQuery"
      >
        <UIcon name="i-lucide-x" class="size-3" />
      </button>
    </div>

    <!-- Match counter / status -->
    <div class="flex items-center px-1 text-2xs font-mono shrink-0 select-none">
      <span
        v-if="regexError"
        class="rounded px-1.5 py-0.5 bg-error/15 text-error ring-1 ring-error/20 font-medium truncate max-w-[160px]"
        :title="regexError"
      >
        Invalid regex
      </span>
      <span
        v-else-if="modelValue.length > 0 && matchCount > 0"
        class="rounded px-1.5 py-0.5 bg-default/80 border border-muted text-muted font-medium"
      >
        <span class="font-bold text-default">{{ currentMatch }}</span> / {{ matchCount }}
      </span>
      <span
        v-else-if="modelValue.length > 0 && !searchPending && matchCount === 0"
        class="rounded px-1.5 py-0.5 bg-error/15 text-error ring-1 ring-error/20 font-medium"
      >
        No matches
      </span>
    </div>

    <!-- Navigation buttons (only relevant when not in filter-only mode or when matches exist) -->
    <UTooltip text="Previous match (Shift+Enter)">
      <UButton
        aria-label="Previous match (Shift+Enter)"
        icon="i-lucide-chevron-up"
        color="neutral"
        variant="ghost"
        size="xs"
        :disabled="matchCount === 0 && !searchPending"
        @click="emit('prev')"
      />
    </UTooltip>
    <UTooltip text="Next match (Enter)">
      <UButton
        aria-label="Next match (Enter)"
        icon="i-lucide-chevron-down"
        color="neutral"
        variant="ghost"
        size="xs"
        :disabled="matchCount === 0 && !searchPending"
        @click="emit('next')"
      />
    </UTooltip>

    <!-- Options: Case Sensitivity, Regex & Filter Mode -->
    <div class="h-4 w-px bg-muted mx-0.5" />

    <UTooltip text="Match Case (Alt+C)">
      <UButton
        label="Aa"
        size="xs"
        :color="caseSensitive ? 'primary' : 'neutral'"
        :variant="caseSensitive ? 'soft' : 'ghost'"
        class="font-mono text-2xs px-1.5 min-w-6"
        @click="emit('update:caseSensitive', !caseSensitive)"
      />
    </UTooltip>

    <UTooltip text="Use Regular Expression (Alt+R)">
      <UButton
        label=".*"
        size="xs"
        :color="isRegex ? 'primary' : 'neutral'"
        :variant="isRegex ? 'soft' : 'ghost'"
        class="font-mono text-2xs px-1.5 min-w-6"
        @click="emit('update:isRegex', !isRegex)"
      />
    </UTooltip>

    <UTooltip text="Filter mode: only display matching lines (Alt+F)">
      <UButton
        aria-label="Filter mode: only display matching lines (Alt+F)"
        icon="i-lucide-filter"
        size="xs"
        :color="filterOnly ? 'primary' : 'neutral'"
        :variant="filterOnly ? 'soft' : 'ghost'"
        class="px-1.5"
        @click="emit('update:filterOnly', !filterOnly)"
      />
    </UTooltip>

    <UTooltip text="Highlight keywords">
      <UButton
        aria-label="Highlight keywords"
        icon="i-lucide-highlighter"
        size="xs"
        :color="highlightOpen || (keywords?.length ?? 0) > 0 ? 'primary' : 'neutral'"
        :variant="highlightOpen || (keywords?.length ?? 0) > 0 ? 'soft' : 'ghost'"
        class="px-1.5"
        @click="highlightOpen = !highlightOpen"
      />
    </UTooltip>

    <slot />
    </div>

    <!-- Keyword Highlight Chips Row -->
    <div v-if="highlightOpen || (keywords?.length ?? 0) > 0" class="flex flex-wrap items-center gap-1.5 border-t border-muted/60 pt-1.5">
      <span class="inline-flex items-center gap-1 text-2xs font-medium text-muted select-none">
        <UIcon name="i-lucide-highlighter" class="size-3" />
        Highlight
      </span>
      <span
        v-for="(keyword, kIdx) in (keywords ?? [])"
        :key="keyword"
        class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-2xs font-medium"
        :class="KEYWORD_CLASSES[kIdx % KEYWORD_CLASSES.length]"
      >
        {{ keyword }}
        <button
          type="button"
          class="leading-none opacity-70 hover:opacity-100 cursor-pointer"
          :aria-label="`Remove ${keyword}`"
          @click="emit('removeKeyword', kIdx)"
        >
          ×
        </button>
      </span>
      <UInput
        v-if="(keywords?.length ?? 0) < KEYWORD_CLASSES.length"
        v-model="keywordDraft"
        size="xs"
        placeholder="Add keyword, press Enter…"
        class="w-44"
        @keyup.enter="submitKeyword"
        @keydown.escape.stop="emit('close')"
      />
      <UButton
        v-if="(keywords?.length ?? 0) > 0"
        label="Clear"
        size="xs"
        color="neutral"
        variant="ghost"
        @click="emit('clearKeywords')"
      />
    </div>
  </div>
</template>
