<script setup lang="ts">
import type { Site } from '@shared/contract'
import UCheckbox from '@nuxt/ui/components/Checkbox.vue'
import type { ContextMenuItem } from '@nuxt/ui/components/ContextMenu.vue'
import { ENVIRONMENT_DOT, ENVIRONMENT_LABEL } from '../../utils/environment'

defineProps<{
  site: Site
  icon: string
  selected: boolean
  selectMode: boolean
  checked: boolean
  connected: boolean
  connecting: boolean
  /** The active picker tab belongs to this site — keeps the existing subtle highlight. */
  active: boolean
  /** Duplicate in progress — spinner on the actions button. */
  busy: boolean
  menuItems: ContextMenuItem[]
}>()

const emit = defineEmits<{
  select: []
  connect: []
  toggle: [checked: boolean]
  delete: []
}>()
</script>

<template>
  <li
    class="group flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-muted"
    :class="selected ? 'bg-primary/10 ring-1 ring-primary/40' : active ? 'bg-primary/5 ring-1 ring-primary/20' : ''"
  >
    <UCheckbox
      v-if="selectMode"
      :model-value="checked"
      tabindex="-1"
      aria-hidden="true"
      @update:model-value="(v: boolean | 'indeterminate') => emit('toggle', v === true)"
    />
    <div
      v-else
      class="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted transition-colors group-hover:bg-default group-hover:text-highlighted"
    >
      <UIcon :name="icon" class="size-3.5" />
    </div>
    <button
      type="button"
      data-site-row
      :data-site-id="site.id"
      class="min-w-0 flex-1 rounded-xs text-left focus-visible:outline-2 focus-visible:outline-primary"
      :role="selectMode ? 'checkbox' : undefined"
      :aria-checked="selectMode ? checked : undefined"
      :title="selectMode ? undefined : 'Double-click or press Enter to connect'"
      :aria-current="!selectMode && selected ? 'true' : undefined"
      :aria-describedby="selectMode ? undefined : `site-hint-${site.id}`"
      @click="selectMode ? emit('toggle', !checked) : emit('select')"
      @dblclick="!selectMode && emit('connect')"
      @keydown.enter.prevent="!selectMode && emit('connect')"
      @keydown.delete.prevent="!selectMode && emit('delete')"
    >
      <div class="flex min-w-0 items-center gap-1.5">
        <span
          v-if="site.environment"
          class="size-2 shrink-0 rounded-full"
          :class="ENVIRONMENT_DOT[site.environment]"
          :title="ENVIRONMENT_LABEL[site.environment]"
        />
        <span v-if="site.environment" class="sr-only">({{ ENVIRONMENT_LABEL[site.environment] }})</span>
        <span class="truncate text-sm font-medium text-highlighted">{{ site.name }}</span>
        <span v-if="site.jumpHosts?.length" class="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted">
          Jump ×{{ site.jumpHosts.length }}
        </span>
        <span
          v-if="connecting"
          class="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-default"
        >
          <UIcon name="i-lucide-loader-circle" class="size-3 animate-spin" />
          Connecting…
        </span>
        <span
          v-else-if="connected"
          class="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-2xs font-medium text-success"
        >
          <span class="size-1.5 rounded-full bg-success" />
          Connected
        </span>
      </div>
      <div class="truncate font-mono text-xs text-muted">{{ site.username }}@{{ site.host }}:{{ site.port }}</div>
      <span :id="`site-hint-${site.id}`" class="sr-only">Press Enter or double-click to connect, Delete to remove</span>
    </button>
    <UDropdownMenu v-if="!selectMode" :items="menuItems">
      <UButton
        icon="i-lucide-ellipsis"
        color="neutral"
        variant="ghost"
        size="sm"
        :aria-label="`Actions for ${site.name}`"
        :loading="busy"
      />
    </UDropdownMenu>
  </li>
</template>
