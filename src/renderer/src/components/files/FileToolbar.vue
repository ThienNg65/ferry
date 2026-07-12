<script setup lang="ts">
defineProps<{ side: 'local' | 'remote' }>()

const emit = defineEmits<{
  up: []
  refresh: []
  mkdir: []
  'toggle-permissions': []
}>()
</script>

<template>
  <div class="flex items-center gap-1 border-b border-muted px-2 py-1">
    <UTooltip text="Go up one level">
      <UButton icon="i-lucide-arrow-up" color="neutral" variant="ghost" size="xs" @click="emit('up')" />
    </UTooltip>
    <UTooltip text="Refresh (Ctrl+R)">
      <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="xs" @click="emit('refresh')" />
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
  </div>
</template>
