<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'

const props = defineProps<{
  modelValue: string
  matchCount: number
  currentMatch: number
  caseSensitive: boolean
  isRegex: boolean
  filterOnly?: boolean
  regexError?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:caseSensitive': [value: boolean]
  'update:isRegex': [value: boolean]
  'update:filterOnly': [value: boolean]
  next: []
  prev: []
  close: []
}>()

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

defineExpose({
  focusInput
})

onMounted(() => {
  focusInput()
})

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
    class="flex items-center gap-1.5 border-b border-muted bg-muted/80 px-2 py-1 text-xs backdrop-blur-sm transition-all"
  >
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
    <div class="flex items-center px-1 text-[11px] font-mono shrink-0 select-none">
      <span
        v-if="regexError"
        class="rounded px-1.5 py-0.5 bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/20 font-medium truncate max-w-[160px]"
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
        v-else-if="modelValue.length > 0 && matchCount === 0"
        class="rounded px-1.5 py-0.5 bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/20 font-medium"
      >
        No matches
      </span>
    </div>

    <!-- Navigation buttons (only relevant when not in filter-only mode or when matches exist) -->
    <UTooltip text="Previous match (Shift+Enter)">
      <UButton
        icon="i-lucide-chevron-up"
        color="neutral"
        variant="ghost"
        size="xs"
        :disabled="matchCount === 0"
        @click="emit('prev')"
      />
    </UTooltip>
    <UTooltip text="Next match (Enter)">
      <UButton
        icon="i-lucide-chevron-down"
        color="neutral"
        variant="ghost"
        size="xs"
        :disabled="matchCount === 0"
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
        class="font-mono text-[11px] px-1.5 min-w-6"
        @click="emit('update:caseSensitive', !caseSensitive)"
      />
    </UTooltip>

    <UTooltip text="Use Regular Expression (Alt+R)">
      <UButton
        label=".*"
        size="xs"
        :color="isRegex ? 'primary' : 'neutral'"
        :variant="isRegex ? 'soft' : 'ghost'"
        class="font-mono text-[11px] px-1.5 min-w-6"
        @click="emit('update:isRegex', !isRegex)"
      />
    </UTooltip>

    <UTooltip text="Filter mode: only display matching lines (Alt+F)">
      <UButton
        icon="i-lucide-filter"
        size="xs"
        :color="filterOnly ? 'primary' : 'neutral'"
        :variant="filterOnly ? 'soft' : 'ghost'"
        class="px-1.5"
        @click="emit('update:filterOnly', !filterOnly)"
      />
    </UTooltip>

    <div class="h-4 w-px bg-muted mx-0.5" />

    <!-- Close button -->
    <UTooltip text="Close (Esc)">
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="emit('close')"
      />
    </UTooltip>
  </div>
</template>
