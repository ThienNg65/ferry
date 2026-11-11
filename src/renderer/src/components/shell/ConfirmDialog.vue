<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  title: string
  body?: string
  items?: string[]
  confirmLabel?: string
  confirmColor?: 'primary' | 'error' | 'warning'
  destructive?: boolean
  action?: () => Promise<void>
  secondaryLabel?: string
  secondaryAction?: () => void | Promise<void>
}>()

const emit = defineEmits<{ close: [value: boolean] }>()

const busy = ref(false)
const error = ref<string | null>(null)

async function onSecondary(): Promise<void> {
  emit('close', false)
  await props.secondaryAction?.()
}

async function onConfirm(): Promise<void> {
  if (!props.action) {
    emit('close', true)
    return
  }
  busy.value = true
  error.value = null
  try {
    await props.action()
    emit('close', true)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal :title="title" :ui="{ footer: 'justify-end' }" @update:open="(v: boolean) => { if (!v) emit('close', false) }">
    <template #body>
      <div class="flex flex-col gap-3">
        <p v-if="body" class="text-sm text-default">{{ body }}</p>
        <ul v-if="items?.length" class="flex max-h-60 flex-col gap-1 overflow-y-auto rounded-md bg-muted p-2">
          <li v-for="item in items" :key="item" class="truncate text-xs text-default">{{ item }}</li>
        </ul>
        <UAlert v-if="error" color="error" variant="soft" :title="error" />
      </div>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" :autofocus="destructive" @click="emit('close', false)">Cancel</UButton>
      <UButton v-if="secondaryLabel" color="neutral" variant="soft" @click="onSecondary">{{ secondaryLabel }}</UButton>
      <UButton :color="confirmColor ?? 'primary'" :loading="busy" :autofocus="!destructive" @click="onConfirm">
        {{ confirmLabel ?? 'Confirm' }}
      </UButton>
    </template>
  </UModal>
</template>
