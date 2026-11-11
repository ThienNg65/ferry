<script setup lang="ts">
defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Everywhere',
    rows: [
      ['Ctrl+K', 'Command palette'],
      ['?', 'This cheat-sheet'],
      ['Ctrl+Tab / Ctrl+Shift+Tab', 'Next / previous site tab'],
      ['Ctrl+W', 'Close site tab']
    ]
  },
  {
    title: 'File panes',
    rows: [
      ['Arrow keys / Shift+Arrows', 'Move / extend selection'],
      ['Enter', 'Open'],
      ['F2', 'Rename'],
      ['Delete', 'Delete selection'],
      ['F5', 'Upload / download selection'],
      ['F6', 'Switch pane'],
      ['Ctrl+A', 'Select all'],
      ['Ctrl+R', 'Refresh'],
      ['Ctrl+F', 'Filter'],
      ['Ctrl+H', 'Show / hide hidden files'],
      ['Alt+Left / Alt+Right', 'Back / forward'],
      ['Backspace', 'Up one level'],
      ['Esc', 'Clear filter or selection']
    ]
  },
  {
    title: 'Terminal and logs',
    rows: [
      ['Ctrl+Shift+F', 'Search the terminal'],
      ['Ctrl+Shift+C / Ctrl+Shift+V', 'Copy / paste in the terminal']
    ]
  }
]
</script>

<template>
  <UModal
    :open="open"
    title="Keyboard shortcuts"
    :ui="{ footer: 'justify-end', content: 'max-w-lg' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
        <section v-for="section in SECTIONS" :key="section.title">
          <h3 class="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{{ section.title }}</h3>
          <table class="w-full text-sm">
            <tbody>
              <tr v-for="[keys, label] in section.rows" :key="keys" class="border-t border-muted first:border-t-0">
                <td class="py-1 pr-3"><kbd class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{{ keys }}</kbd></td>
                <td class="py-1 text-default">{{ label }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" @click="emit('update:open', false)">Close</UButton>
    </template>
  </UModal>
</template>
