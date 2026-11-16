<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useNotify } from '../../composables/useNotify'
import { useUiStore } from '../../stores/ui.store'
import { collapseBreadcrumbSegments, parseBreadcrumbSegments, type BreadcrumbSegment } from '../../utils/pathBreadcrumb'

const props = defineProps<{ path: string }>()
const emit = defineEmits<{ navigate: [path: string] }>()

const notify = useNotify()
const ui = useUiStore()
const editing = ref(false)
const draft = ref(props.path)

const segments = computed(() => parseBreadcrumbSegments(props.path))
const breadcrumbs = computed(() => collapseBreadcrumbSegments(segments.value))
const collapsedMenuItems = computed(() =>
  breadcrumbs.value.collapsed.map((seg) => ({
    label: seg.label,
    icon: 'i-lucide-folder',
    onSelect: () => emit('navigate', seg.fullPath)
  }))
)
const strip = ref<HTMLElement | null>(null)

function scrollToEnd(): void {
  if (!ui.shortenPath && strip.value) {
    strip.value.scrollLeft = strip.value.scrollWidth
  }
}

watch(() => [props.path, editing.value, ui.shortenPath], () => void nextTick(scrollToEnd), { flush: 'post' })
onMounted(scrollToEnd)

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
  <div class="min-w-0 flex-1 px-1">
    <UInput
      v-if="editing"
      v-model="draft"
      size="xs"
      class="w-full font-mono"
      autofocus
      @keyup.enter="submit"
      @keyup.esc="cancelEdit"
      @blur="cancelEdit"
    />
    <div v-else class="group flex min-w-0 flex-1 items-center gap-1 text-xs">
      <div
        ref="strip"
        class="flex min-w-0 flex-1 items-center gap-0.5"
        :class="ui.shortenPath ? 'overflow-hidden' : 'overflow-x-auto scrollbar-none'"
        @click.self="startEdit"
      >
        <template v-if="ui.shortenPath">
          <button
            v-if="breadcrumbs.root"
            type="button"
            class="shrink-0 rounded px-1 py-0.5 transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
            :class="
              !breadcrumbs.current
                ? 'font-medium text-highlighted'
                : 'text-muted hover:text-default'
            "
            :title="!breadcrumbs.current ? 'Click to edit path' : `Go to ${breadcrumbs.root.fullPath}`"
            @click="onSegmentClick(breadcrumbs.root, !breadcrumbs.current)"
          >
            {{ breadcrumbs.root.label }}
          </button>
          <template v-if="breadcrumbs.collapsed.length > 0">
            <span
              v-if="breadcrumbs.root && breadcrumbs.root.label !== '/' && !breadcrumbs.root.label.endsWith('\\')"
              class="shrink-0 select-none text-dimmed"
            >
              /
            </span>
            <UDropdownMenu :items="collapsedMenuItems">
              <button
                type="button"
                aria-label="Parent directories"
                title="Parent directories"
                class="shrink-0 rounded px-1 py-0.5 text-muted transition-colors hover:bg-elevated hover:text-default focus-visible:outline-2 focus-visible:outline-primary"
              >
                …
              </button>
            </UDropdownMenu>
            <span class="shrink-0 select-none text-dimmed">{{ breadcrumbs.root?.label.endsWith('\\') ? '\\' : '/' }}</span>
          </template>
          <button
            v-if="breadcrumbs.current"
            type="button"
            class="min-w-0 truncate rounded px-1 py-0.5 font-medium text-highlighted transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
            :title="`${breadcrumbs.current.fullPath} (click to edit path)`"
            @click="onSegmentClick(breadcrumbs.current, true)"
          >
            {{ breadcrumbs.current.label }}
          </button>
        </template>
        <template v-else>
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
              class="shrink-0 select-none text-dimmed"
            >
              {{ segments[0]?.label.endsWith('\\') ? '\\' : '/' }}
            </span>
          </template>
        </template>
        <button
          type="button"
          aria-label="Edit path"
          title="Click to edit path"
          class="min-w-4 flex-1 self-stretch cursor-text"
          @click="startEdit"
        />
      </div>
      <div class="hidden shrink-0 items-center gap-0.5 group-hover:flex group-focus-within:flex">
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
