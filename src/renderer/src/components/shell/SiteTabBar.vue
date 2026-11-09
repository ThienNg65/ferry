<script setup lang="ts">
import { useSessionsStore } from '../../stores/sessions.store'
import { useUiStore } from '../../stores/ui.store'

const sessions = useSessionsStore()
const ui = useUiStore()

function onCloseTab(event: MouseEvent, tabId: string): void {
  event.stopPropagation()
  void sessions.closeTab(tabId)
}
</script>

<template>
  <div class="flex items-center gap-1 overflow-x-auto border-b border-accented bg-muted px-2 py-1">
    <div
      v-for="tab in sessions.tabs"
      :key="tab.tabId"
      class="group flex max-w-52 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors"
      :class="
        tab.tabId === sessions.activeTabId
          ? 'border-primary/30 bg-primary/10 font-medium text-primary'
          : 'border-transparent text-muted hover:bg-elevated hover:text-default'
      "
      :title="tab.hostLabel ? `${tab.label ?? 'Tab'} (${tab.hostLabel})` : (tab.label ?? 'New Tab')"
      @click="sessions.setActiveTab(tab.tabId)"
      @auxclick.middle.prevent="onCloseTab($event, tab.tabId)"
    >
      <UIcon v-if="tab.connecting" name="i-lucide-loader-2" class="size-3.5 shrink-0 animate-spin" />
      <UIcon
        v-else-if="tab.status === 'error'"
        name="i-lucide-circle-alert"
        class="size-3.5 shrink-0 text-error"
      />
      <span
        v-else-if="tab.status === 'connected'"
        class="size-2 shrink-0 rounded-full bg-emerald-500"
      />
      <UIcon
        v-else-if="tab.siteId"
        name="i-lucide-server"
        class="size-3 shrink-0 text-muted"
      />
      <span class="truncate">{{ tab.label ?? 'New Tab' }}</span>
      <UTooltip text="Close tab (Middle-click)">
        <button
          type="button"
          aria-label="Close tab"
          class="ml-0.5 shrink-0 rounded p-0.5 transition-opacity hover:bg-default focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-primary"
          :class="
            tab.tabId === sessions.activeTabId
              ? 'opacity-70 hover:opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          "
          @click="onCloseTab($event, tab.tabId)"
        >
          <UIcon name="i-lucide-x" class="size-3" />
        </button>
      </UTooltip>
    </div>
    <UTooltip text="New tab">
      <UButton
        icon="i-lucide-plus"
        size="xs"
        variant="ghost"
        color="neutral"
        aria-label="New tab"
        @click="sessions.openNewTab()"
      />
    </UTooltip>
    <div class="flex-1"></div>
    <UTooltip :text="ui.showLocalPane ? 'Hide Local pane' : 'Show Local pane'">
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        :icon="ui.showLocalPane ? 'i-lucide-panel-left-close' : 'i-lucide-panel-left-open'"
        :aria-label="ui.showLocalPane ? 'Hide Local pane' : 'Show Local pane'"
        @click="ui.toggleLocalPane()"
      />
    </UTooltip>
  </div>
</template>
