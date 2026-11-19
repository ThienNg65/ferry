<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '../../stores/ui.store'

const props = withDefaults(
  defineProps<{
    size?: number
    variant?: 'auto' | 'glass' | 'classic'
    decorative?: boolean
  }>(),
  {
    size: 24,
    variant: 'auto',
    decorative: false
  }
)

const ui = useUiStore()
const variant = computed(() =>
  props.variant === 'auto' ? (ui.glassUiEnabled ? 'glass' : 'classic') : props.variant
)
</script>

<template>
  <img
    :src="`./ferry-${variant}.svg`"
    :width="size"
    :height="size"
    :alt="decorative ? '' : 'Ferry'"
    class="shrink-0 select-none"
    :data-ferry-logo="variant"
  />
</template>
