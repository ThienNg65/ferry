<script setup lang="ts">
import { ref } from 'vue'

defineOptions({ inheritAttrs: false })

withDefaults(
  defineProps<{
    modelValue?: string
    label?: string
  }>(),
  {
    modelValue: '',
    label: 'password'
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const visible = ref(false)
const inputComp = ref<{ inputRef?: HTMLInputElement } | null>(null)

defineExpose({
  get inputRef(): HTMLInputElement | undefined {
    return inputComp.value?.inputRef
  }
})
</script>

<template>
  <UInput
    ref="inputComp"
    v-bind="$attrs"
    :model-value="modelValue"
    :type="visible ? 'text' : 'password'"
    :ui="{ trailing: 'pe-1' }"
    @update:model-value="(v: unknown) => emit('update:modelValue', String(v ?? ''))"
  >
    <template #trailing>
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        size="xs"
        :icon="visible ? 'i-lucide-eye-off' : 'i-lucide-eye'"
        :aria-label="visible ? `Hide ${label}` : `Show ${label}`"
        :aria-pressed="visible"
        @click="visible = !visible"
      />
    </template>
  </UInput>
</template>
