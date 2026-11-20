<script setup lang="ts">
defineProps<{ label: string; description?: string; stacked?: boolean; forId?: string }>()
</script>

<template>
  <div
    class="flex gap-3 border-b border-muted py-3 last:border-b-0"
    :class="stacked ? 'flex-col' : 'flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-6'"
  >
    <div class="min-w-0">
      <label v-if="forId" :for="forId" class="text-sm font-medium text-highlighted">
        <slot name="label">{{ label }}</slot>
      </label>
      <div v-else class="text-sm font-medium text-highlighted">
        <slot name="label">{{ label }}</slot>
      </div>
      <p v-if="description" class="mt-0.5 text-xs text-muted">{{ description }}</p>
    </div>
    <div :class="stacked ? 'w-full' : 'shrink-0'">
      <slot />
    </div>
  </div>
</template>
