<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { CompanionCommandCard, CompanionCommandRisk } from '@shared/contract'
import { useCompanionStore } from '../../stores/companion.store'
import { useRemoteFsStore } from '../../stores/remoteFs.store'
import { useSessionsStore } from '../../stores/sessions.store'
import { useTerminalStreamsStore } from '../../stores/terminalStreams.store'
import { classifyCommandRisk, type CompanionSnippet } from '../../utils/companionSnippets'
import {
  defaultSnippetParamValues,
  extractSnippetParams,
  interpolateSnippetCommand
} from '../../utils/snippetParams'

const props = defineProps<{
  open: boolean
  initialPrompt?: string
}>()

const emit = defineEmits<{ close: [] }>()

const companion = useCompanionStore()
const sessions = useSessionsStore()
const remoteFs = useRemoteFsStore()
const terminalStreams = useTerminalStreamsStore()

const query = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const statusText = ref<string | null>(null)
const generatedCard = ref<CompanionCommandCard | null>(null)
const selectedIndex = ref(0)

// Inline {{param}} prompt state for parameterized snippets
const activeTemplate = ref<{ label: string; command: string; params: string[]; values: Record<string, string> } | null>(null)

const isAlternateScreen = computed(() =>
  sessions.activeSessionId ? terminalStreams.isAlternateScreen(sessions.activeSessionId) : false
)

const matchedSnippets = computed<CompanionSnippet[]>(() => {
  const q = query.value.trim().toLowerCase()
  const list = companion.allSnippets
  if (!q) return list.slice(0, 5)
  return list
    .filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.command.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
    )
    .slice(0, 5)
})

const resolvedTemplateCommand = computed(() => {
  if (!activeTemplate.value) return ''
  return interpolateSnippetCommand(activeTemplate.value.command, activeTemplate.value.values)
})

const resolvedTemplateRisk = computed<CompanionCommandRisk>(() =>
  classifyCommandRisk(resolvedTemplateCommand.value)
)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      query.value = props.initialPrompt ?? ''
      generatedCard.value = null
      activeTemplate.value = null
      statusText.value = null
      selectedIndex.value = 0
      void nextTick(() => inputRef.value?.focus())
    }
  },
  { immediate: true }
)

function getParamContext() {
  const selected = Array.from(remoteFs.selected ?? [])
  const firstSelected = selected[0] ?? null
  const entry = firstSelected ? remoteFs.entries.find((e) => e.path === firstSelected) : null
  return {
    remoteCwd: remoteFs.currentPath,
    selectedPath: firstSelected,
    selectedName: entry?.name ?? null,
    siteName: sessions.activeTab?.label ?? null
  }
}

function selectSnippet(snippet: CompanionSnippet): void {
  const params = extractSnippetParams(snippet.command)
  if (params.length > 0) {
    activeTemplate.value = {
      label: snippet.label,
      command: snippet.command,
      params,
      values: defaultSnippetParamValues(params, getParamContext())
    }
    generatedCard.value = null
    return
  }
  void insertAndClose(snippet.command)
}

async function generateCommand(): Promise<void> {
  const text = query.value.trim()
  if (!text || busy.value) return
  busy.value = true
  statusText.value = null
  generatedCard.value = null
  activeTemplate.value = null
  try {
    const res = await companion.requestQuickCommand(text)
    if (res.card) {
      generatedCard.value = res.card
    } else {
      statusText.value = res.message || 'No command generated.'
    }
  } finally {
    busy.value = false
  }
}

async function insertAndClose(command: string): Promise<void> {
  if (isAlternateScreen.value) {
    statusText.value = 'Full-screen app active — copy command instead.'
    return
  }
  statusText.value = await companion.insertCommandInTerminal(command)
  emit('close')
}

async function runAndClose(card: CompanionCommandCard): Promise<void> {
  if (isAlternateScreen.value) {
    statusText.value = 'Full-screen app active — copy command instead.'
    return
  }
  const msg = await companion.runCommandCard(card)
  statusText.value = msg
  if (msg.startsWith('Sent command')) {
    emit('close')
  }
}

async function copyCommand(command: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(command)
    statusText.value = 'Copied to clipboard.'
  } catch {
    statusText.value = 'Could not access clipboard.'
  }
}

function onInputKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
    return
  }
  if (e.key === 'ArrowDown' && matchedSnippets.value.length > 0) {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value + 1) % matchedSnippets.value.length
    return
  }
  if (e.key === 'ArrowUp' && matchedSnippets.value.length > 0) {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value - 1 + matchedSnippets.value.length) % matchedSnippets.value.length
    return
  }
  if (e.key === 'Enter' && e.ctrlKey && generatedCard.value) {
    e.preventDefault()
    void runAndClose(generatedCard.value)
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    if (generatedCard.value) {
      void insertAndClose(generatedCard.value.command)
      return
    }
    if (!query.value.trim() && matchedSnippets.value[selectedIndex.value]) {
      selectSnippet(matchedSnippets.value[selectedIndex.value])
      return
    }
    void generateCommand()
  }
}

function riskClass(risk: CompanionCommandRisk): string {
  if (risk === 'destructive') return 'bg-error/15 text-error ring-1 ring-error/30'
  if (risk === 'mutating') return 'bg-warning/15 text-warning ring-1 ring-warning/30'
  return 'bg-success/15 text-success ring-1 ring-success/30'
}
</script>

<template>
  <div
    v-if="open"
    data-terminal-quick-bar
    role="region"
    aria-label="Quick Terminal Command Bar"
    class="absolute inset-x-3 bottom-3 z-20 mx-auto max-w-2xl rounded-lg border border-primary/40 bg-default/95 p-2.5 shadow-xl backdrop-blur-md"
    @keydown.esc.stop.prevent="emit('close')"
  >
    <div
      v-if="isAlternateScreen"
      data-alt-screen-guard
      class="mb-2 flex items-center gap-1.5 rounded bg-warning/15 px-2 py-1 text-2xs font-medium text-warning"
    >
      <UIcon name="i-lucide-shield-alert" class="size-3.5 shrink-0" />
      <span>Full-screen terminal app active (alternate buffer) — Insert/Run disabled; Copy only.</span>
    </div>

    <div class="flex items-center gap-1.5">
      <UIcon name="i-lucide-sparkles" class="size-4 shrink-0 text-primary" />
      <input
        ref="inputRef"
        v-model="query"
        type="text"
        placeholder="Describe a command or search snippets… (Enter to generate, Esc to close)"
        aria-label="Quick terminal command prompt"
        class="min-w-0 flex-1 rounded bg-muted/40 px-2 py-1 text-xs text-default outline-none focus:ring-1 focus:ring-primary"
        @keydown="onInputKeydown"
      />
      <UButton
        size="xs"
        color="primary"
        variant="soft"
        :loading="busy"
        :disabled="!query.trim()"
        @click="generateCommand"
      >
        Generate
      </UButton>
      <UButton
        icon="i-lucide-x"
        size="xs"
        color="neutral"
        variant="ghost"
        aria-label="Close quick command bar"
        @click="emit('close')"
      />
    </div>

    <!-- Parameterized snippet prompt -->
    <div v-if="activeTemplate" class="mt-2 rounded border border-default bg-muted/30 p-2 text-xs">
      <p class="font-medium text-highlighted">{{ activeTemplate.label }}</p>
      <div class="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <label v-for="param in activeTemplate.params" :key="param" class="flex flex-col gap-0.5 text-2xs">
          <span class="font-mono text-muted">{{ param }}</span>
          <input
            v-model="activeTemplate.values[param]"
            type="text"
            class="rounded border border-default bg-default px-1.5 py-1 font-mono text-2xs text-default outline-none focus:border-primary"
          />
        </label>
      </div>
      <pre class="mt-2 overflow-x-auto rounded bg-default px-2 py-1 font-mono text-2xs text-default">{{ resolvedTemplateCommand }}</pre>
      <div class="mt-2 flex items-center gap-1.5">
        <span class="rounded-full px-1.5 py-0.5 font-mono text-3xs font-semibold" :class="riskClass(resolvedTemplateRisk)">
          {{ resolvedTemplateRisk === 'destructive' ? 'Destructive' : resolvedTemplateRisk === 'mutating' ? 'Mutating' : 'Read-only' }}
        </span>
        <UButton
          size="xs"
          color="primary"
          variant="soft"
          icon="i-lucide-terminal"
          :disabled="isAlternateScreen || !resolvedTemplateCommand"
          @click="insertAndClose(resolvedTemplateCommand)"
        >
          Insert
        </UButton>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-copy"
          :disabled="!resolvedTemplateCommand"
          @click="copyCommand(resolvedTemplateCommand)"
        >
          Copy
        </UButton>
      </div>
    </div>

    <!-- Generated Command Card -->
    <div v-else-if="generatedCard" class="mt-2 rounded border border-default bg-muted/30 p-2 text-xs">
      <div class="flex items-center justify-between gap-2">
        <span class="truncate text-2xs font-medium text-highlighted">{{ generatedCard.description }}</span>
        <span class="shrink-0 rounded-full px-1.5 py-0.5 font-mono text-3xs font-semibold" :class="riskClass(generatedCard.risk)">
          {{ generatedCard.risk === 'destructive' ? 'Destructive' : generatedCard.risk === 'mutating' ? 'Mutating' : 'Read-only' }}
        </span>
      </div>
      <pre class="mt-1.5 overflow-x-auto rounded bg-default px-2 py-1 font-mono text-2xs text-default select-text">{{ generatedCard.command }}</pre>
      <div class="mt-2 flex flex-wrap items-center gap-1.5">
        <UButton
          size="xs"
          color="primary"
          variant="soft"
          icon="i-lucide-terminal"
          :disabled="isAlternateScreen"
          data-quick-insert
          @click="insertAndClose(generatedCard.command)"
        >
          Insert (Enter)
        </UButton>
        <UButton
          size="xs"
          :color="generatedCard.risk === 'destructive' ? 'error' : generatedCard.risk === 'mutating' ? 'warning' : 'neutral'"
          variant="outline"
          icon="i-lucide-play"
          :disabled="isAlternateScreen"
          data-quick-run
          @click="runAndClose(generatedCard)"
        >
          Run (Ctrl+Enter)
        </UButton>
        <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-copy" @click="copyCommand(generatedCard.command)">
          Copy
        </UButton>
      </div>
    </div>

    <!-- Matching snippets list -->
    <div v-else-if="matchedSnippets.length > 0" class="mt-2 flex flex-col gap-0.5">
      <button
        v-for="(snip, idx) in matchedSnippets"
        :key="snip.id"
        type="button"
        class="flex w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-left text-2xs transition-colors"
        :class="idx === selectedIndex ? 'bg-primary/12 text-highlighted' : 'text-default hover:bg-muted/60'"
        @click="selectSnippet(snip)"
      >
        <span class="truncate font-medium">{{ snip.label }}</span>
        <code class="max-w-[55%] truncate font-mono text-3xs text-muted">{{ snip.command }}</code>
      </button>
    </div>

    <p v-if="statusText" role="status" class="mt-1.5 text-3xs text-muted">{{ statusText }}</p>
  </div>
</template>
