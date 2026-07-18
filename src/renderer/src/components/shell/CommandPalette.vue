<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
// Not yet in the auto-generated global components.d.ts — deep-import instead
// of relying on <UCommandPalette> (see ImportSessionsDialog.vue/ChmodDialog.vue
// for the same pattern with <UCheckbox>).
import UCommandPalette from '@nuxt/ui/components/CommandPalette.vue'
import { useSessionsStore } from '../../stores/sessions.store'
import { useSitesStore } from '../../stores/sites.store'
import { useUiStore } from '../../stores/ui.store'
import { useSettingsDialog } from '../../composables/useSettingsDialog'

const open = ref(false)
const sessions = useSessionsStore()
const sites = useSitesStore()
const ui = useUiStore()
const settingsDialog = useSettingsDialog()

function onKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    open.value = !open.value
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

function run(action: () => void): void {
  action()
  open.value = false
}

const groups = computed(() => [
  {
    id: 'actions',
    label: 'Actions',
    items: [
      { label: 'New tab', icon: 'i-lucide-plus', onSelect: () => run(() => sessions.openNewTab()) },
      {
        label: ui.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        icon: 'i-lucide-sun-moon',
        onSelect: () => run(() => ui.toggleTheme())
      },
      {
        label: ui.showLocalPane ? 'Hide Local pane' : 'Show Local pane',
        icon: 'i-lucide-panel-left',
        onSelect: () => run(() => ui.toggleLocalPane())
      },
      { label: 'Settings…', icon: 'i-lucide-settings', onSelect: () => run(() => settingsDialog.open()) }
    ]
  },
  {
    id: 'sites',
    label: 'Connect to site',
    items: sites.sites.map((site) => ({
      label: site.name,
      suffix: `${site.username}@${site.host}`,
      icon: 'i-lucide-server',
      onSelect: () => run(() => void sessions.connectToSite(site))
    }))
  }
])
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'max-w-lg' }">
    <template #content>
      <UCommandPalette :groups="groups" placeholder="Type a command or search sites…" :close="false" />
    </template>
  </UModal>
</template>
