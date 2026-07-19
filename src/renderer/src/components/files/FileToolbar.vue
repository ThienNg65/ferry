<script setup lang="ts">
import Popover from '@nuxt/ui/components/Popover.vue'
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

function onFilterInput(value: string | number): void {
  emit('update:filterText', String(value))
}
</script>

<template>
  <div class="flex items-center gap-1 border-b border-muted px-2 py-1">
    <UTooltip text="Go up one level">
      <UButton icon="i-lucide-arrow-up" color="neutral" variant="ghost" size="xs" @click="emit('up')" />
    </UTooltip>
    <UTooltip text="Refresh (Ctrl+R)">
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        size="xs"
        :ui="{ leadingIcon: loading ? 'animate-spin' : '' }"
        @click="emit('refresh')"
      />
    </UTooltip>
    <UTooltip text="New folder">
      <UButton icon="i-lucide-folder-plus" color="neutral" variant="ghost" size="xs" @click="emit('mkdir')" />
    </UTooltip>
    <UTooltip v-if="side === 'remote'" text="Switch permissions display (technical/friendly)">
      <UButton
        icon="i-lucide-shield"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="emit('toggle-permissions')"
      />
    </UTooltip>
    <UInput
      :model-value="filterText ?? ''"
      icon="i-lucide-search"
      placeholder="Filter…"
      size="xs"
      class="w-32"
      :ui="{ trailing: 'pointer-events-auto' }"
      @update:model-value="onFilterInput"
    >
      <template v-if="filterText" #trailing>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="link"
          size="xs"
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
    <UTooltip v-if="showSync" text="Sync this folder…">
      <UButton icon="i-lucide-folder-sync" color="neutral" variant="ghost" size="xs" @click="emit('sync-folder')" />
    </UTooltip>
    <Popover v-if="canBookmark !== false">
      <UTooltip text="Bookmarks">
        <UButton icon="i-lucide-bookmark" color="neutral" variant="ghost" size="xs" />
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
              class="opacity-0 group-hover:opacity-100"
              @click="emit('remove-bookmark', b.id)"
            />
          </div>
        </div>
      </template>
    </Popover>
  </div>
</template>
