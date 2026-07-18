<script setup lang="ts">
import { ref, watch } from 'vue'
import { useSettingsStore } from '../../stores/settings.store'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const settings = useSettingsStore()
const unlimited = ref(true)
const limitInput = ref(1024)
const saving = ref(false)

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      return
    }
    await settings.fetch()
    unlimited.value = settings.bandwidthLimitKBps === null
    limitInput.value = settings.bandwidthLimitKBps ?? 1024
  }
)

function close(): void {
  emit('update:open', false)
}

async function save(): Promise<void> {
  saving.value = true
  try {
    await settings.setBandwidthLimitKBps(unlimited.value ? null : Math.max(1, Math.round(limitInput.value)))
    close()
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Settings"
    :ui="{ footer: 'justify-end', content: 'max-w-md' }"
    @update:open="(v: boolean) => { if (!v) close() }"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <div class="text-sm font-medium text-highlighted">Transfer bandwidth limit</div>
        <label class="flex items-center gap-2 text-sm text-default">
          <input type="checkbox" v-model="unlimited" class="size-4" />
          Unlimited
        </label>
        <div class="flex items-center gap-2">
          <UInput
            v-model.number="limitInput"
            type="number"
            :min="1"
            :disabled="unlimited"
            class="w-32"
          />
          <span class="text-xs text-muted">KB/s, applies to all transfers combined</span>
        </div>
      </div>
    </template>

    <template #footer>
      <UButton color="neutral" variant="outline" @click="close">Cancel</UButton>
      <UButton :loading="saving" @click="save">Save</UButton>
    </template>
  </UModal>
</template>
