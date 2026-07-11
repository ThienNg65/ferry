<script setup lang="ts">
const emit = defineEmits<{
  up: []
  refresh: []
  mkdir: []
}>()
</script>

<template>
  <div class="flex items-center gap-1 border-b border-muted px-2 py-1">
    <UButton icon="i-lucide-arrow-up" color="neutral" variant="ghost" size="xs" @click="emit('up')" />
    <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="xs" @click="emit('refresh')" />
    <UButton icon="i-lucide-folder-plus" color="neutral" variant="ghost" size="xs" @click="emit('mkdir')" />
  </div>
</template>
