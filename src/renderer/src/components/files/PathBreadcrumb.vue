<script setup lang="ts">
import { ref } from 'vue'

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
    <button v-else class="w-full truncate text-left text-xs text-muted hover:text-default" @click="startEdit">
      {{ path || '/' }}
    </button>
  </div>
</template>
