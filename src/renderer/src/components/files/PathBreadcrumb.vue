<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{ path: string }>()
const emit = defineEmits<{ navigate: [path: string] }>()

const editing = ref(false)
const draft = ref(props.path)

function startEdit(): void {
  draft.value = props.path
  editing.value = true
}

function submit(): void {
  editing.value = false
  if (draft.value && draft.value !== props.path) {
    emit('navigate', draft.value)
  }
}

// Emphasize the current directory's own name over the path leading to it.
const parentPart = computed(() => {
  const p = props.path || '/'
  const idx = p.replace(/\/+$/, '').lastIndexOf('/')
  return idx > 0 ? p.slice(0, idx + 1) : idx === 0 ? '/' : ''
})
const lastSegment = computed(() => {
  const p = props.path || '/'
  const trimmed = p.replace(/\/+$/, '')
  if (trimmed === '') {
    return '/'
  }
  const idx = trimmed.lastIndexOf('/')
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
})
</script>

<template>
  <div class="border-b border-muted px-3 py-1.5">
    <UInput
      v-if="editing"
      v-model="draft"
      size="xs"
      class="w-full"
      autofocus
      @keyup.enter="submit"
      @blur="submit"
    />
    <button v-else class="w-full truncate text-left text-xs" @click="startEdit">
      <span class="text-muted">{{ parentPart }}</span><span class="font-medium text-default">{{ lastSegment }}</span>
    </button>
  </div>
</template>
