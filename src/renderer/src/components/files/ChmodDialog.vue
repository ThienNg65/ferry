<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { FileEntry } from '@shared/contract'
import { formatMode, parseMode, toTechnical } from '../../utils/permissions'
// Neither has been used elsewhere in the app yet, so neither is in the
// auto-generated global components.d.ts — deep-import instead of relying on
// <UCheckbox>/<USwitch> (see FileRow.vue's ContextMenu for the same pattern).
import UCheckbox from '@nuxt/ui/components/Checkbox.vue'

const props = defineProps<{
  open: boolean
  entry: FileEntry | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  submit: [entry: FileEntry, mode: string, extras: { recursive: boolean; owner: string; group: string }]
}>()

const owner = reactive({ read: false, write: false, execute: false })
const group = reactive({ read: false, write: false, execute: false })
const other = reactive({ read: false, write: false, execute: false })

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      return
    }
    recursive.value = false
    ownerName.value = ''
    groupName.value = ''
    if (!props.entry?.permissions) {
      return
    }
    const parsed = parseMode(props.entry.permissions)
    Object.assign(owner, parsed.owner)
    Object.assign(group, parsed.group)
    Object.assign(other, parsed.other)
  }
)

const recursive = ref(false)
const ownerName = ref('')
const groupName = ref('')

const mode = computed(() => formatMode({ owner, group, other }))
const technical = computed(() => toTechnical(mode.value))

function submit(): void {
  if (props.entry) {
    emit('submit', props.entry, mode.value, {
      recursive: recursive.value,
      owner: ownerName.value.trim(),
      group: groupName.value.trim()
    })
  }
  emit('update:open', false)
}
</script>

<template>
  <UModal
    :open="open"
    title="Permissions"
    :ui="{ footer: 'justify-end' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <p class="truncate text-sm text-default">{{ entry?.name }}</p>
        <table class="w-full text-sm">
          <thead>
            <tr class="text-xs text-muted">
              <th class="text-left font-normal"></th>
              <th class="font-normal">Read</th>
              <th class="font-normal">Write</th>
              <th class="font-normal">Execute</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="py-1 text-xs text-muted">Owner</td>
              <td class="text-center"><UCheckbox v-model="owner.read" /></td>
              <td class="text-center"><UCheckbox v-model="owner.write" /></td>
              <td class="text-center"><UCheckbox v-model="owner.execute" /></td>
            </tr>
            <tr>
              <td class="py-1 text-xs text-muted">Group</td>
              <td class="text-center"><UCheckbox v-model="group.read" /></td>
              <td class="text-center"><UCheckbox v-model="group.write" /></td>
              <td class="text-center"><UCheckbox v-model="group.execute" /></td>
            </tr>
            <tr>
              <td class="py-1 text-xs text-muted">Other</td>
              <td class="text-center"><UCheckbox v-model="other.read" /></td>
              <td class="text-center"><UCheckbox v-model="other.write" /></td>
              <td class="text-center"><UCheckbox v-model="other.execute" /></td>
            </tr>
          </tbody>
        </table>
        <div class="flex items-center justify-between rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted">
          <span>{{ technical }}</span>
          <span>{{ mode }}</span>
        </div>
        <div class="flex gap-3">
          <UFormField label="Owner" hint="Optional" class="flex-1">
            <UInput v-model="ownerName" placeholder="e.g. deploy" class="w-full" />
          </UFormField>
          <UFormField label="Group" hint="Optional" class="flex-1">
            <UInput v-model="groupName" placeholder="e.g. www-data" class="w-full" />
          </UFormField>
        </div>
        <UCheckbox
          v-if="entry?.isDir"
          v-model="recursive"
          label="Apply recursively"
          description="Sets this exact mode on every file and folder inside."
        />
      </div>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" @click="emit('update:open', false)">Cancel</UButton>
      <UButton @click="submit">Apply</UButton>
    </template>
  </UModal>
</template>
