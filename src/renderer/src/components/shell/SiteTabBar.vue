<script setup lang="ts">
import { useSessionsStore } from '../../stores/sessions.store'

const sessions = useSessionsStore()

function onCloseTab(event: MouseEvent, tabId: string): void {
  event.stopPropagation()
  void sessions.closeTab(tabId)
}
</script>

<template>
  <div class="flex items-center gap-1 overflow-x-auto border-b border-muted bg-default/80 px-2 py-1">
    <div
      v-for="tab in sessions.tabs"
      :key="tab.tabId"
      class="group flex max-w-48 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs"
      :class="tab.tabId === sessions.activeTabId ? 'bg-accented text-highlighted' : 'text-muted hover:bg-muted'"
      @click="sessions.setActiveTab(tab.tabId)"
    >
      <UIcon v-if="tab.connecting" name="i-lucide-loader-2" class="size-3.5 shrink-0 animate-spin" />
      <UIcon
        v-else-if="tab.status === 'error'"
        name="i-lucide-circle-alert"
        class="size-3.5 shrink-0 text-error"
      />
      <span class="truncate">{{ tab.label ?? 'New Tab' }}</span>
      <button
        type="button"
        aria-label="Close tab"
        class="ml-0.5 shrink-0 rounded opacity-0 transition-opacity hover:bg-default group-hover:opacity-100"
        @click="onCloseTab($event, tab.tabId)"
      >
        <UIcon name="i-lucide-x" class="size-3.5" />
      </button>
    </div>
    <UButton
      icon="i-lucide-plus"
      size="xs"
      variant="ghost"
      color="neutral"
      aria-label="New tab"
      @click="sessions.openNewTab()"
    />
  </div>
</template>
