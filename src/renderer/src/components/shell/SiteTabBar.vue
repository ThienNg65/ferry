<script setup lang="ts">
import { useSessionsStore } from '../../stores/sessions.store'
import { useSitesStore } from '../../stores/sites.store'
import { useUiStore } from '../../stores/ui.store'
import { ENVIRONMENT_TAB_BORDER } from '../../utils/environment'
import { onTablistKeydown } from '../../utils/tablistKeys'

const sessions = useSessionsStore()
const ui = useUiStore()
const sites = useSitesStore()

function envBorder(siteId: string | null): string {
  const env = siteId ? sites.sites.find((s) => s.id === siteId)?.environment : undefined
  return env ? ENVIRONMENT_TAB_BORDER[env] : 'border-transparent'
}

/** Hide `user@host` when the tab's label already is (or contains) the host, e.g. a site named after its IP. */
function showHost(label: string | null | undefined, hostLabel: string | null | undefined): boolean {
  return Boolean(label && hostLabel && !label.includes(hostLabel.split('@').pop() ?? hostLabel))
}

function onCloseTab(event: MouseEvent, tabId: string): void {
  event.stopPropagation()
  void sessions.closeTab(tabId)
}
</script>

<template>
  <!-- The hairline is an inset shadow (not a border) so the active tab, flush with the bottom edge, paints over it and joins the canvas below. -->
  <div class="relative flex items-end gap-1 overflow-x-auto bg-muted px-2 pt-1 shadow-[inset_0_-1px_0_var(--ui-border-muted)]">
    <TransitionGroup name="site-tab" tag="div" class="contents" role="tablist" aria-label="Open sites" @keydown="onTablistKeydown($event, true)">
    <div
      v-for="tab in sessions.tabs"
      :key="tab.tabId"
      role="tab"
      :aria-selected="tab.tabId === sessions.activeTabId"
      :tabindex="tab.tabId === sessions.activeTabId ? 0 : -1"
      class="ferry-site-tab group flex max-w-64 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-t-md border-t-2 px-2.5 py-1.5 text-xs transition-colors"
      :class="[
        envBorder(tab.siteId),
        tab.tabId === sessions.activeTabId
          ? 'bg-default font-medium text-highlighted'
          : 'text-muted hover:bg-elevated hover:text-default'
      ]"
      :title="tab.hostLabel ? `${tab.label ?? 'Tab'} (${tab.hostLabel})` : (tab.label ?? 'New Tab')"
      @click="sessions.setActiveTab(tab.tabId)"
      @keydown.enter.self="sessions.setActiveTab(tab.tabId)"
      @keydown.space.self.prevent="sessions.setActiveTab(tab.tabId)"
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
        class="size-2 shrink-0 rounded-full bg-success"
      />
      <UIcon
        v-else-if="tab.siteId"
        name="i-lucide-server"
        class="size-3 shrink-0 text-muted"
      />
      <span class="truncate">{{ tab.label ?? tab.hostLabel ?? 'New Tab' }}</span>
      <span
        v-if="tab.tabId === sessions.activeTabId && showHost(tab.label, tab.hostLabel)"
        class="min-w-0 truncate font-normal text-muted"
      >
        {{ tab.hostLabel }}
      </span>
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
    </TransitionGroup>
    <UTooltip text="New tab">
      <UButton
        icon="i-lucide-plus"
        class="mb-1"
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
        class="mb-1"
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
