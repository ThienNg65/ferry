<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import Popover from '@nuxt/ui/components/Popover.vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Bookmark } from '@shared/contract'

const props = defineProps<{
  side: 'local' | 'remote'
  loading?: boolean
  selectedCount?: number
  transferIcon?: string
  filterText?: string
  bookmarks?: Bookmark[]
  /** False hides the bookmark button entirely — e.g. a quick-connect tab with no saved site to attach a remote bookmark to. */
  canBookmark?: boolean
  /** Shows the "Sync this folder" button — only meaningful on the remote pane while connected. */
  showSync?: boolean
}>()

const emit = defineEmits<{
  up: []
  refresh: []
  mkdir: []
  'toggle-permissions': []
  'transfer-selected': []
  'update:filterText': [value: string]
  bookmark: []
  'jump-bookmark': [path: string]
  'remove-bookmark': [id: string]
  'sync-folder': []
}>()

const moreItems = computed<DropdownMenuItem[]>(() => {
  const items: DropdownMenuItem[] = [{ label: 'New folder', icon: 'i-lucide-folder-plus', onSelect: () => emit('mkdir') }]
  if (props.showSync) {
    items.push({ label: 'Sync this folder…', icon: 'i-lucide-folder-sync', onSelect: () => emit('sync-folder') })
  }
  if (props.side === 'remote') {
    items.push({ label: 'Switch permissions display', icon: 'i-lucide-shield', onSelect: () => emit('toggle-permissions') })
  }
  return items
})

const filterInputRef = ref<{ inputRef?: HTMLInputElement } | HTMLInputElement | null>(null)

function focusFilter(): void {
  void nextTick(() => {
    const el =
      filterInputRef.value && 'inputRef' in filterInputRef.value
        ? filterInputRef.value.inputRef
        : (filterInputRef.value as HTMLInputElement | null)
    if (el) {
      el.focus()
      el.select()
    }
  })
}

defineExpose({ focusFilter })

function onFilterInput(value: string | number): void {
  emit('update:filterText', String(value))
}
</script>

<template>
  <div class="flex shrink-0 items-center gap-1 pr-2">
    <UTooltip text="Go up one level (Backspace)">
      <UButton icon="i-lucide-arrow-up" color="neutral" variant="ghost" size="xs" aria-label="Go up one level" @click="emit('up')" />
    </UTooltip>
    <UTooltip text="Refresh (Ctrl+R)">
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        size="xs"
        aria-label="Refresh"
        :ui="{ leadingIcon: loading ? 'animate-spin' : '' }"
        @click="emit('refresh')"
      />
    </UTooltip>
    <UInput
      ref="filterInputRef"
      :model-value="filterText ?? ''"
      icon="i-lucide-search"
      placeholder="Filter (Ctrl+F)…"
      size="xs"
      class="w-24 transition-[width] focus-within:w-40"
      :ui="{ trailing: 'pointer-events-auto' }"
      @update:model-value="onFilterInput"
    >
      <template v-if="filterText" #trailing>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="link"
          size="xs"
          aria-label="Clear filter"
          :padded="false"
          @click="emit('update:filterText', '')"
        />
      </template>
    </UInput>
    <UTooltip
      v-if="selectedCount && transferIcon"
      :text="side === 'local' ? `Upload ${selectedCount} selected` : `Download ${selectedCount} selected`"
    >
      <UButton :icon="transferIcon" color="primary" variant="soft" size="xs" @click="emit('transfer-selected')">
        {{ selectedCount }}
      </UButton>
    </UTooltip>
    <Popover v-if="canBookmark !== false">
      <UTooltip text="Bookmarks">
        <UButton icon="i-lucide-bookmark" color="neutral" variant="ghost" size="xs" aria-label="Bookmarks" />
      </UTooltip>
      <template #content>
        <div class="flex w-64 flex-col gap-1 p-2">
          <UButton
            icon="i-lucide-bookmark-plus"
            color="neutral"
            variant="ghost"
            size="xs"
            class="justify-start"
            @click="emit('bookmark')"
          >
            Bookmark this folder
          </UButton>
          <div v-if="bookmarks && bookmarks.length > 0" class="my-1 border-t border-muted"></div>
          <div
            v-for="b in bookmarks"
            :key="b.id"
            class="group flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted"
          >
            <UButton
              icon="i-lucide-folder"
              color="neutral"
              variant="ghost"
              size="xs"
              class="min-w-0 flex-1 justify-start truncate"
              :title="b.path"
              @click="emit('jump-bookmark', b.path)"
            >
              <span class="truncate">{{ b.label }}</span>
            </UButton>
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="xs"
              aria-label="Remove bookmark"
              class="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
              @click="emit('remove-bookmark', b.id)"
            />
          </div>
        </div>
      </template>
    </Popover>
    <UDropdownMenu :items="moreItems">
      <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="xs" aria-label="More actions" />
    </UDropdownMenu>
  </div>
</template>
