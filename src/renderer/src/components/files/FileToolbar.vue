<script setup lang="ts">
defineProps<{ side: 'local' | 'remote'; loading?: boolean; selectedCount?: number; transferIcon?: string }>()

const emit = defineEmits<{
  up: []
  refresh: []
  mkdir: []
  'toggle-permissions': []
  'transfer-selected': []
}>()
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
    <UTooltip
      v-if="selectedCount && transferIcon"
      :text="side === 'local' ? `Upload ${selectedCount} selected` : `Download ${selectedCount} selected`"
    >
      <UButton :icon="transferIcon" color="primary" variant="soft" size="xs" @click="emit('transfer-selected')">
        {{ selectedCount }}
      </UButton>
    </UTooltip>
  </div>
</template>
