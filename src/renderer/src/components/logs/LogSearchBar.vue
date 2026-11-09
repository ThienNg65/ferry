<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'

const props = defineProps<{
  modelValue: string
  matchCount: number
  currentMatch: number
  caseSensitive: boolean
  isRegex: boolean
  regexError?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:caseSensitive': [value: boolean]
  'update:isRegex': [value: boolean]
  next: []
  prev: []
  close: []
}>()

const inputRef = ref<{ inputRef?: HTMLInputElement } | HTMLInputElement | null>(null)

function focusInput(): void {
  void nextTick(() => {
    const el = inputRef.value && 'inputRef' in inputRef.value ? inputRef.value.inputRef : (inputRef.value as HTMLInputElement | null)
    if (el) {
      el.focus()
      el.select()
    }
  })
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
  }
}
</script>

<template>
  <div
    class="flex items-center gap-1.5 border-b border-muted bg-muted/80 px-2 py-1 text-xs backdrop-blur-sm transition-all"
  >
    <div class="relative flex min-w-[200px] max-w-sm flex-1 items-center">
      <UInput
        ref="inputRef"
        :model-value="modelValue"
        placeholder="Find in log (Ctrl+F)…"
        icon="i-lucide-search"
        size="xs"
        class="w-full"
        :color="regexError ? 'error' : 'neutral'"
        @update:model-value="emit('update:modelValue', String($event))"
        @keydown="onKeydown"
      />
    </div>

    <!-- Match counter / status -->
    <div class="flex items-center px-1 text-[11px] font-mono shrink-0 select-none">
      <span v-if="regexError" class="text-error truncate max-w-[150px]" :title="regexError">
        Invalid regex
      </span>
      <span v-else-if="modelValue.length > 0 && matchCount > 0" class="text-muted">
        <span class="font-semibold text-default">{{ currentMatch }}</span> / {{ matchCount }}
      </span>
      <span v-else-if="modelValue.length > 0 && matchCount === 0" class="text-error font-medium">
        No matches
      </span>
    </div>

    <!-- Navigation buttons -->
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

    <!-- Options: Case Sensitivity & Regex -->
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
