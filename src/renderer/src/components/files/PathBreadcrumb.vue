<script setup lang="ts">
import { computed, ref } from 'vue'
import { useNotify } from '../../composables/useNotify'
import { parseBreadcrumbSegments, type BreadcrumbSegment } from '../../utils/pathBreadcrumb'

const props = defineProps<{ path: string }>()
const emit = defineEmits<{ navigate: [path: string] }>()

const notify = useNotify()
const editing = ref(false)
const draft = ref(props.path)

const segments = computed(() => parseBreadcrumbSegments(props.path))

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

function cancelEdit(): void {
  draft.value = props.path
  editing.value = false
}

function onSegmentClick(segment: BreadcrumbSegment, isLast: boolean): void {
  if (isLast) {
    startEdit()
    return
  }
  emit('navigate', segment.fullPath)
}

async function copyCurrentPath(): Promise<void> {
  if (!props.path) return
  try {
    await navigator.clipboard.writeText(props.path)
    notify.success('Path copied', props.path)
  } catch (e) {
    notify.error('Could not copy path', e instanceof Error ? e.message : String(e))
  }
}
</script>

<template>
  <div class="border-b border-muted px-2 py-1">
    <UInput
      v-if="editing"
      v-model="draft"
      size="xs"
      class="w-full font-mono"
      autofocus
      @keyup.enter="submit"
      @keyup.esc="cancelEdit"
      @blur="submit"
    />
    <div v-else class="group flex items-center gap-1 text-xs">
      <div
        class="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto scrollbar-none"
        @click.self="startEdit"
      >
        <template v-for="(seg, idx) in segments" :key="seg.fullPath">
          <button
            type="button"
            class="shrink-0 rounded px-1 py-0.5 transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
            :class="
              idx === segments.length - 1
                ? 'font-medium text-highlighted'
                : 'text-muted hover:text-default'
            "
            :title="idx === segments.length - 1 ? 'Click to edit path' : `Go to ${seg.fullPath}`"
            @click="onSegmentClick(seg, idx === segments.length - 1)"
          >
            {{ seg.label }}
          </button>
          <span
            v-if="idx < segments.length - 1 && seg.label !== '/' && !seg.label.endsWith('\\')"
            class="select-none text-dimmed"
          >
            /
          </span>
        </template>
        <button
          type="button"
          aria-label="Edit path"
          title="Click to edit path"
          class="min-w-4 flex-1 self-stretch cursor-text"
          @click="startEdit"
        />
      </div>
      <div class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <UTooltip text="Edit path">
          <UButton
            icon="i-lucide-pencil"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Edit path"
            @click="startEdit"
          />
        </UTooltip>
        <UTooltip text="Copy path">
          <UButton
            icon="i-lucide-copy"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Copy path"
            @click="copyCurrentPath"
          />
        </UTooltip>
      </div>
    </div>
  </div>
</template>
