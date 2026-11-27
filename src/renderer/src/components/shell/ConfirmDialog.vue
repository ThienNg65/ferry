<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  title: string
  body?: string
  prodWarning?: string
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
let openedAt = performance.now()

function onModalEnter(): void {
  openedAt = performance.now()
}

async function onSecondary(): Promise<void> {
  emit('close', false)
  await props.secondaryAction?.()
}

async function onConfirm(event?: MouseEvent): Promise<void> {
  if (busy.value) return
  if (
    props.destructive &&
    event &&
    typeof event.detail === 'number' &&
    event.detail > 0 &&
    performance.now() - openedAt < 280
  ) {
    return
  }
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
  <UModal
    :title="title"
    :dismissible="!busy"
    :close="!busy"
    :ui="{ footer: 'flex-wrap justify-end' }"
    @enter="onModalEnter"
    @update:open="(v: boolean) => { if (!v && !busy) emit('close', false) }"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <UAlert
          v-if="prodWarning"
          data-confirm-prod-warning
          role="alert"
          color="error"
          variant="soft"
          icon="i-lucide-shield-alert"
          title="Production Environment"
          :description="prodWarning"
        />
        <p v-if="body" class="text-sm text-default">{{ body }}</p>
        <ul v-if="items?.length" class="flex max-h-60 flex-col gap-1 overflow-y-auto rounded-md bg-muted p-2">
          <li v-for="item in items" :key="item" class="break-all text-xs text-default">{{ item }}</li>
        </ul>
        <UAlert v-if="error" role="alert" color="error" variant="soft" :title="error" />
      </div>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" :disabled="busy" :autofocus="destructive" @click="emit('close', false)">Cancel</UButton>
      <UButton v-if="secondaryLabel" color="neutral" variant="soft" :disabled="busy" @click="onSecondary">{{ secondaryLabel }}</UButton>
      <UButton
        :color="confirmColor ?? 'primary'"
        :loading="busy"
        :aria-busy="busy || undefined"
        :aria-disabled="busy || undefined"
        :autofocus="!destructive"
        @click="onConfirm($event)"
      >
        {{ confirmLabel ?? 'Confirm' }}
      </UButton>
    </template>
  </UModal>
</template>
