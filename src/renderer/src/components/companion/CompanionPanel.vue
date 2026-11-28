<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Popover from '@nuxt/ui/components/Popover.vue'
import USwitch from '@nuxt/ui/components/Switch.vue'
import type { CompanionCommandCard, CompanionCommandRisk, CompanionUiActionCard } from '@shared/contract'
import { openExternal } from '../../bridge/neutralinoApi'
import { useCompanionStore, type CompanionView } from '../../stores/companion.store'
import { useRemoteFsStore } from '../../stores/remoteFs.store'
import { useSessionsStore } from '../../stores/sessions.store'
import { useUiStore } from '../../stores/ui.store'
import { OFFICIAL_RELEASES_URL } from '../../utils/companionChangelogFallback'
import type { CompanionActionChip } from '../../utils/companionEngine'
import { classifyCommandRisk, type CompanionSnippet } from '../../utils/companionSnippets'
import {
  defaultSnippetParamValues,
  extractSnippetParams,
  interpolateSnippetCommand
} from '../../utils/snippetParams'
import { COMPANION_TOUR_STEPS } from '../../utils/companionTour'
import { onTablistKeydown } from '../../utils/tablistKeys'
import { trapTabWithinElement } from '../../composables/useDialogFocusTrap'
import CompanionAvatar from './CompanionAvatar.vue'
import CompanionIssueForm from './CompanionIssueForm.vue'

const props = withDefaults(defineProps<{ mode?: 'split' | 'overlay' }>(), { mode: 'overlay' })
const isSplitMode = computed(() => props.mode === 'split')

const companion = useCompanionStore()
const remoteFs = useRemoteFsStore()
const sessions = useSessionsStore()
const ui = useUiStore()

const draftInput = ref('')
const inputFocused = ref(false)

const subtitle = computed(() => {
  if (companion.quietMode) return 'Quiet Mode on'
  const state = companion.effectiveAvatarState
  if (state === 'idle' && !companion.isProd) return 'A little friend who knows your workspace'
  return [state !== 'idle' ? companion.avatarLabel : null, companion.prodSiteLabel].filter(Boolean).join(' · ')
})

function isRevealing(msg: { id: string }): boolean {
  return companion.reveal?.messageId === msg.id || companion.streamingMessageId === msg.id
}
function displayText(msg: { id: string; text: string }): string {
  const r = companion.reveal
  return r && r.messageId === msg.id ? r.chunks.slice(0, r.shown).join('') : msg.text
}
const panelRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const scrollContainerRef = ref<HTMLElement | null>(null)
const actionFeedback = ref<string | null>(null)
const prefsOpen = ref(false)
const pendingRunCard = ref<CompanionCommandCard | null>(null)
const runConfirmOpen = computed({
  get: () => pendingRunCard.value !== null,
  set: (v: boolean) => {
    if (!v) pendingRunCard.value = null
  }
})
const snippetFilter = ref('')
const showSnippetForm = ref(false)
const editingSnippetId = ref<string | null>(null)
const newSnippetLabel = ref('')
const newSnippetCommand = ref('')
const newSnippetDescription = ref('')
const aiSnippetPrompt = ref('')
const aiSnippetDrafting = ref(false)
const pendingParamSnippet = ref<{
  snippet: CompanionSnippet
  action: 'run' | 'insert'
  params: string[]
  values: Record<string, string>
} | null>(null)
let previouslyFocused: HTMLElement | null = null

const currentTourStep = computed(() =>
  companion.tourStep !== null ? (COMPANION_TOUR_STEPS[companion.tourStep] ?? null) : null
)

const views: { id: CompanionView; label: string; icon: string }[] = [
  { id: 'chat', label: 'Chat', icon: 'i-lucide-message-circle' },
  { id: 'snippets', label: 'Snippets', icon: 'i-lucide-terminal' },
  { id: 'whats-new', label: "What's New", icon: 'i-lucide-sparkles' },
  { id: 'report', label: 'Report', icon: 'i-lucide-bug' },
  { id: 'history', label: 'Updates', icon: 'i-lucide-bell' }
]

const filteredSnippets = computed(() => {
  const q = snippetFilter.value.trim().toLowerCase()
  if (!q) return companion.allSnippets
  return companion.allSnippets.filter(
    (s) =>
      s.label.toLowerCase().includes(q) ||
      s.command.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
  )
})

const draftSnippetRisk = computed(() => classifyCommandRisk(newSnippetCommand.value))

const quickStarters = computed(() => {
  const items: Array<{ label: string; prompt: string; icon: string }> = []
  const errRec = companion.lastTransferErrorRecord
  if (errRec) {
    const isConn =
      errRec.category === 'ssh-connect' ||
      errRec.category === 'host-key' ||
      errRec.category === 'proxy' ||
      errRec.category === 'bastion'
    const isOp = errRec.category === 'operation'
    items.push({
      label: isConn
        ? 'Troubleshoot connection failure'
        : isOp
          ? 'Investigate failed operation'
          : 'Investigate failed transfer',
      prompt: isConn
        ? 'Help me troubleshoot the SSH connection failure'
        : isOp
          ? 'Help me troubleshoot the failed remote operation'
          : 'Help me troubleshoot the failed transfer',
      icon: 'i-lucide-alert-triangle'
    })
  }
  items.push({
    label: "Discover what's new",
    prompt: "What's new in this version?",
    icon: 'i-lucide-sparkles'
  })
  if (sessions.status === 'connected') {
    items.push({
      label: 'Filter visible files',
      prompt: 'How do I use file filters?',
      icon: 'i-lucide-filter'
    })
  }
  items.push(
    { label: 'Command to check disk usage', prompt: 'Command to check disk usage', icon: 'i-lucide-terminal' },
    { label: 'Take the 4-step tour', prompt: 'Start guided tour', icon: 'i-lucide-map' },
    { label: 'Help me use Ferry', prompt: 'Help me use Ferry', icon: 'i-lucide-compass' },
    { label: 'Report a problem', prompt: 'I want to report a bug', icon: 'i-lucide-bug' }
  )
  return items
})

const currentRelease = computed(() => {
  if (companion.releases.length === 0) return null
  return companion.releases.find((r) => r.version === companion.currentVersion) ?? companion.releases[0]
})

const otherReleases = computed(() => {
  const cur = currentRelease.value
  if (!cur) return []
  return companion.releases.filter((r) => r.version !== cur.version).slice(0, 6)
})

watch(
  () => companion.open,
  (isOpen, wasOpen) => {
    if (isOpen) {
      const active = document.activeElement
      if (
        active instanceof HTMLElement &&
        active !== document.body &&
        active !== document.documentElement &&
        !active.closest('[data-companion-trigger]') &&
        !active.closest('[data-command-palette]') &&
        !active.closest('[role="dialog"]')
      ) {
        previouslyFocused = active
      } else {
        previouslyFocused = null
      }
      void nextTick(() => {
        if (companion.activeView === 'chat') {
          inputRef.value?.focus()
        } else {
          panelRef.value?.focus()
        }
      })
    } else if (wasOpen) {
      const target = previouslyFocused
      previouslyFocused = null
      if (target && target.isConnected) {
        target.focus()
      } else {
        const fallback = document.querySelector<HTMLElement>(
          '[data-companion-trigger], [data-pane] [tabindex="0"], main [tabindex="0"]'
        )
        fallback?.focus()
      }
    }
  },
  { immediate: true }
)

watch(
  () => [companion.messages.length, companion.reveal?.shown, companion.reveal === null],
  () => {
    void nextTick(() => {
      const el = scrollContainerRef.value
      if (el) {
        el.scrollTop = el.scrollHeight
      }
    })
  }
)

watch(
  () => companion.activeView,
  (view) => {
    if (view === 'whats-new') {
      void companion.ensureReleasesLoaded()
    }
    if (view !== 'chat') companion.finishReveal()
  }
)

function onPanelTabKeydown(e: KeyboardEvent): void {
  // WAI-ARIA APG: trap Tab only in modal overlay mode, never in split/complementary mode.
  if (isSplitMode.value || !companion.open || prefsOpen.value || pendingRunCard.value) return
  if (document.querySelector('[role="dialog"]:not([data-state="closed"]):not([data-companion-panel])')) {
    return
  }
  trapTabWithinElement(e, panelRef.value)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented || !companion.open) return
  if (e.target instanceof HTMLElement && e.target.closest('.xterm')) return
  if (prefsOpen.value || pendingRunCard.value) {
    return
  }
  if (document.querySelector('[role="dialog"]:not([data-state="closed"]):not([data-companion-panel])')) {
    return
  }
  e.preventDefault()
  e.stopPropagation()
  companion.closePanel()
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))

// A removed/hidden input never fires blur, so drop focus when the chat input goes away.
watch([() => companion.activeView, () => companion.open], ([v, o]) => {
  if (v !== 'chat' || !o) inputFocused.value = false
})
watch([inputFocused, draftInput], ([f, t]) => companion.setListening(f && t.trim() !== ''))
onBeforeUnmount(() => companion.setListening(false))

async function onSend(): Promise<void> {
  const text = draftInput.value.trim()
  if (!text) return
  draftInput.value = ''
  actionFeedback.value = null
  await companion.ask(text)
}

async function onQuickStarter(prompt: string): Promise<void> {
  actionFeedback.value = null
  await companion.ask(prompt)
}

async function onActionClick(action: CompanionActionChip): Promise<void> {
  actionFeedback.value = await companion.executeAction(action)
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatInlineMarkdown(text: string): string {
  const parts = text.split(/(`[^`]+`)/g)
  let out = ''
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]
    if (!part) continue
    if (i % 2 === 1 && part.startsWith('`') && part.endsWith('`')) {
      out += `<code class="rounded bg-default/70 px-1 py-0.5 font-mono text-2xs">${escapeHtml(part.slice(1, -1))}</code>`
    } else {
      out += escapeHtml(part).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    }
  }
  return out
}

function renderSafeChatMarkdown(raw: string): string {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  const blocks: string[] = []
  let listItems: string[] = []
  let textLines: string[] = []

  const flushList = (): void => {
    if (listItems.length > 0) {
      blocks.push(`<ul class="my-1 list-disc space-y-0.5 pl-4">${listItems.join('')}</ul>`)
      listItems = []
    }
  }
  const flushText = (): void => {
    if (textLines.length > 0) {
      blocks.push(`<p class="my-0.5 first:mt-0 last:mb-0">${textLines.join('<br />')}</p>`)
      textLines = []
    }
  }

  for (const line of lines) {
    const bulletMatch = line.match(/^\s*[-*•]\s+(.+)$/)
    if (bulletMatch) {
      flushText()
      listItems.push(`<li>${formatInlineMarkdown(bulletMatch[1])}</li>`)
    } else if (line.trim() === '') {
      flushList()
      flushText()
    } else {
      flushList()
      textLines.push(formatInlineMarkdown(line))
    }
  }
  flushList()
  flushText()
  return blocks.join('')
}

function uiActionCardTarget(card: CompanionUiActionCard): string {
  if (card.kind === 'apply-filter') return `${card.mode}: ${card.pattern}`
  return card.remotePath
}

const activeHostLabel = computed(
  () => sessions.activeTab?.label || sessions.activeTab?.hostLabel || 'active server'
)

const pendingRunRisk = computed<CompanionCommandRisk>(() => {
  const card = pendingRunCard.value
  if (!card) return 'read_only'
  const detected = classifyCommandRisk(card.command)
  const rank: Record<CompanionCommandRisk, number> = { read_only: 0, mutating: 1, destructive: 2 }
  return rank[detected] > rank[card.risk] ? detected : card.risk
})

async function onRunCommandCard(card: CompanionCommandCard): Promise<void> {
  if (sessions.status !== 'connected' || !sessions.activeSessionId) {
    actionFeedback.value = await companion.runCommandCard(card)
    return
  }
  pendingRunCard.value = card
}

async function confirmPendingRunCommand(): Promise<void> {
  const card = pendingRunCard.value
  pendingRunCard.value = null
  if (!card) return
  actionFeedback.value = await companion.runCommandCard(card, { skipConfirm: true })
}

async function onInsertCommand(command: string): Promise<void> {
  actionFeedback.value = await companion.insertCommandInTerminal(command)
}

function onStopAi(): void {
  void companion.cancelAiRequest()
  actionFeedback.value = 'Stopped response.'
}

async function onUiActionCardClick(card: CompanionUiActionCard): Promise<void> {
  actionFeedback.value = await companion.executeUiActionCard(card)
}

async function copyCommandText(command: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(command)
    actionFeedback.value = 'Copied command to clipboard.'
  } catch {
    actionFeedback.value = 'Could not access clipboard.'
  }
}

function saveCardAsSnippet(card: CompanionCommandCard): void {
  const saved = companion.saveCustomSnippet({
    label: card.description.slice(0, 50) || card.command.slice(0, 32),
    command: card.command,
    description: card.description
  })
  actionFeedback.value = saved ? `Saved "${saved.label}" to Snippets.` : 'Could not save snippet.'
}

function onCreateSnippet(): void {
  const saved = editingSnippetId.value
    ? companion.updateCustomSnippet(editingSnippetId.value, {
        label: newSnippetLabel.value,
        command: newSnippetCommand.value,
        description: newSnippetDescription.value
      })
    : companion.saveCustomSnippet({
        label: newSnippetLabel.value,
        command: newSnippetCommand.value,
        description: newSnippetDescription.value
      })
  if (!saved) {
    actionFeedback.value = 'Enter a valid label and shell command.'
    return
  }
  const wasEdit = Boolean(editingSnippetId.value)
  editingSnippetId.value = null
  newSnippetLabel.value = ''
  newSnippetCommand.value = ''
  newSnippetDescription.value = ''
  aiSnippetPrompt.value = ''
  showSnippetForm.value = false
  actionFeedback.value = wasEdit ? `Updated snippet "${saved.label}".` : `Saved snippet "${saved.label}".`
}

function startEditSnippet(snip: CompanionSnippet): void {
  editingSnippetId.value = snip.id
  newSnippetLabel.value = snip.label
  newSnippetCommand.value = snip.command
  newSnippetDescription.value = snip.description
  showSnippetForm.value = true
}

function toggleNewSnippetForm(): void {
  if (showSnippetForm.value) {
    showSnippetForm.value = false
    editingSnippetId.value = null
    newSnippetLabel.value = ''
    newSnippetCommand.value = ''
    newSnippetDescription.value = ''
    aiSnippetPrompt.value = ''
  } else {
    editingSnippetId.value = null
    showSnippetForm.value = true
  }
}

async function draftSnippetWithAi(): Promise<void> {
  const prompt = aiSnippetPrompt.value.trim()
  if (!prompt || aiSnippetDrafting.value) return
  aiSnippetDrafting.value = true
  try {
    const res = await companion.requestQuickCommand(prompt)
    if (res.card) {
      if (!newSnippetLabel.value.trim()) {
        newSnippetLabel.value = res.card.description.slice(0, 50) || prompt.slice(0, 50)
      }
      newSnippetCommand.value = res.card.command
      newSnippetDescription.value = res.card.description
      actionFeedback.value = 'Snippet drafted. Review it, then save.'
    } else {
      actionFeedback.value = res.message || 'Could not draft snippet.'
    }
  } finally {
    aiSnippetDrafting.value = false
  }
}

function invokeSnippetAction(snip: CompanionSnippet, action: 'run' | 'insert'): void {
  const params = extractSnippetParams(snip.command)
  if (params.length > 0) {
    const selected = Array.from(remoteFs.selected ?? [])
    const firstSelected = selected[0] ?? null
    const entry = firstSelected ? remoteFs.entries.find((e) => e.path === firstSelected) : null
    pendingParamSnippet.value = {
      snippet: snip,
      action,
      params,
      values: defaultSnippetParamValues(params, {
        remoteCwd: remoteFs.currentPath,
        selectedPath: firstSelected,
        selectedName: entry?.name ?? null,
        siteName: sessions.activeTab?.label ?? null
      })
    }
    return
  }
  if (action === 'run') {
    void onRunCommandCard({ command: snip.command, description: snip.description || snip.label, risk: snip.risk })
  } else {
    void onInsertCommand(snip.command)
  }
}

const resolvedParamSnippetCommand = computed(() => {
  if (!pendingParamSnippet.value) return ''
  return interpolateSnippetCommand(pendingParamSnippet.value.snippet.command, pendingParamSnippet.value.values)
})

function submitParamSnippet(): void {
  const pending = pendingParamSnippet.value
  if (!pending) return
  const resolved = resolvedParamSnippetCommand.value
  pendingParamSnippet.value = null
  if (!resolved) return
  if (pending.action === 'run') {
    void onRunCommandCard({
      command: resolved,
      description: pending.snippet.description || pending.snippet.label,
      risk: classifyCommandRisk(resolved)
    })
  } else {
    void onInsertCommand(resolved)
  }
}

function riskBadgeLabel(risk: CompanionCommandRisk): string {
  if (risk === 'destructive') return 'Destructive'
  if (risk === 'mutating') return 'Mutating'
  return 'Read-only'
}

function riskBadgeClass(risk: CompanionCommandRisk): string {
  if (risk === 'destructive') return 'bg-error/15 text-error ring-1 ring-error/30'
  if (risk === 'mutating') return 'bg-warning/15 text-warning ring-1 ring-warning/30'
  return 'bg-success/15 text-success ring-1 ring-success/30'
}

function uiActionCardIcon(kind: CompanionUiActionCard['kind']): string {
  if (kind === 'open-editor') return 'i-lucide-file-pen'
  if (kind === 'tail-log') return 'i-lucide-scroll-text'
  return 'i-lucide-filter'
}

function openFullNotes(url?: string): void {
  void openExternal(url || OFFICIAL_RELEASES_URL).catch(() => {})
}
</script>

<template>
  <Teleport to="body" :disabled="isSplitMode">
  <Transition :name="isSplitMode ? '' : 'slide-right'">
    <aside
      v-if="companion.open"
      ref="panelRef"
      tabindex="-1"
      :role="isSplitMode ? 'complementary' : 'dialog'"
      :aria-modal="isSplitMode ? undefined : 'true'"
      aria-label="Ferry Companion"
      :class="[
        isSplitMode
          ? 'relative z-20 flex h-full w-[380px] shrink-0 flex-col border-l border-default focus:outline-none'
          : 'pointer-events-auto fixed top-9 right-0 bottom-0 z-[60] flex w-[380px] max-w-[calc(100vw-0.5rem)] flex-col border-l border-default shadow-xl focus:outline-none',
        ui.glassUiEnabled
          ? 'ferry-glass-overlay rounded-l-[var(--ferry-radius-overlay)] rounded-r-none border-r-0 border-b-0'
          : 'bg-default'
      ]"
      data-companion-panel
      :data-companion-mode="props.mode"
      @keydown.tab="onPanelTabKeydown"
    >
      <!-- Header -->
      <div class="flex items-center justify-between gap-2 border-b border-muted px-3 py-2 select-none">
        <div class="flex min-w-0 items-center gap-2">
          <CompanionAvatar
            :state="companion.effectiveAvatarState"
            :size="20"
            :prod="companion.isProd"
            :chunk="companion.reveal?.shown ?? 0"
            live
          />
          <div class="min-w-0">
            <h2 class="truncate text-xs font-semibold text-highlighted">Ferry Companion</h2>
            <p class="truncate text-3xs text-muted">
              {{ subtitle }}
            </p>
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-0.5">
          <UTooltip v-if="companion.activeView === 'chat' && companion.messages.length > 0" text="Clear conversation">
            <UButton
              icon="i-lucide-trash-2"
              color="neutral"
              variant="ghost"
              size="xs"
              aria-label="Clear conversation"
              @click="companion.clearConversation()"
            />
          </UTooltip>
          <Popover v-model:open="prefsOpen" :content="{ align: 'end', sideOffset: 6 }">
            <UTooltip text="Companion preferences">
              <UButton
                icon="i-lucide-sliders-horizontal"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="Companion preferences"
              />
            </UTooltip>
            <template #content>
              <div class="flex w-64 flex-col gap-2.5 p-3 text-xs">
                <p class="font-semibold text-highlighted">Companion preferences</p>
                <label class="flex items-center justify-between gap-2 cursor-pointer">
                  <div>
                    <p class="font-medium text-default">Quiet Mode</p>
                    <p class="text-3xs text-muted">Mute all proactive bubbles and tips</p>
                  </div>
                  <USwitch
                    :model-value="companion.quietMode"
                    size="xs"
                    aria-label="Quiet Mode"
                    @update:model-value="companion.setQuietMode(Boolean($event))"
                  />
                </label>
                <label class="flex items-center justify-between gap-2 cursor-pointer">
                  <div>
                    <p class="font-medium text-default">Show in dock</p>
                    <p class="text-3xs text-muted">Keep a companion icon in the dock</p>
                  </div>
                  <USwitch
                    :model-value="companion.showInDock"
                    size="xs"
                    aria-label="Show Companion in dock"
                    @update:model-value="companion.setShowInDock(Boolean($event))"
                  />
                </label>
                <label class="flex items-center justify-between gap-2 cursor-pointer">
                  <div>
                    <p class="font-medium text-default">Release announcements</p>
                    <p class="text-3xs text-muted">Show What's New once per update</p>
                  </div>
                  <USwitch
                    :model-value="companion.showReleaseAnnouncements"
                    size="xs"
                    aria-label="Show release announcements"
                    @update:model-value="companion.setShowReleaseAnnouncements(Boolean($event))"
                  />
                </label>
                <label class="flex items-center justify-between gap-2 cursor-pointer">
                  <div>
                    <p class="font-medium text-default">Contextual tips</p>
                    <p class="text-3xs text-muted">Daily greeting & transfer error help</p>
                  </div>
                  <USwitch
                    :model-value="companion.contextualTips"
                    size="xs"
                    aria-label="Contextual tips"
                    @update:model-value="companion.setContextualTips(Boolean($event))"
                  />
                </label>
              </div>
            </template>
          </Popover>

          <UTooltip :text="ui.companionLayoutMode === 'split' ? 'Float as overlay' : 'Dock side-by-side'">
            <UButton
              :icon="ui.companionLayoutMode === 'split' ? 'i-lucide-picture-in-picture-2' : 'i-lucide-panel-right'"
              color="neutral"
              variant="ghost"
              size="xs"
              :aria-label="ui.companionLayoutMode === 'split' ? 'Float Companion as overlay' : 'Dock Companion side-by-side'"
              data-companion-layout-toggle
              @click="ui.toggleCompanionLayoutMode()"
            />
          </UTooltip>
          <UTooltip text="Close (Esc)">
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="xs"
              aria-label="Close Ferry Companion"
              @click="companion.closePanel()"
            />
          </UTooltip>
        </div>
      </div>

      <!-- View switcher -->
      <div
        class="flex items-center gap-1 border-b border-muted px-2 py-1.5"
        role="tablist"
        aria-label="Companion sections"
        @keydown="onTablistKeydown($event, true)"
      >
        <button
          v-for="v in views"
          :id="`companion-tab-${v.id}`"
          :key="v.id"
          type="button"
          role="tab"
          :aria-selected="companion.activeView === v.id"
          :aria-controls="`companion-panel-${v.id}`"
          :tabindex="companion.activeView === v.id ? 0 : -1"
          class="inline-flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-md px-1 py-1 text-2xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary"
          :class="
            companion.activeView === v.id
              ? 'bg-primary/12 text-primary'
              : 'text-muted hover:bg-elevated/70 hover:text-default'
          "
          @click="companion.activeView = v.id"
        >
          <UIcon :name="v.icon" class="size-3.5 shrink-0" />
          <span class="truncate">{{ v.label }}</span>
        </button>
      </div>

      <!-- Body -->
      <div
        :id="`companion-panel-${companion.activeView}`"
        ref="scrollContainerRef"
        role="tabpanel"
        :aria-labelledby="`companion-tab-${companion.activeView}`"
        class="min-h-0 flex-1 overflow-y-auto p-3"
      >
        <!-- CHAT VIEW -->
        <div v-if="companion.activeView === 'chat'" class="flex min-h-full flex-col gap-3">
          <!-- Guided multi-step tour card -->
          <div
            v-if="currentTourStep && companion.tourStep !== null"
            class="rounded-lg border border-primary/35 bg-primary/8 p-3 text-xs"
            data-companion-tour
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-mono text-3xs font-semibold uppercase tracking-wide text-primary">
                Guided Tour · Step {{ companion.tourStep + 1 }} of {{ COMPANION_TOUR_STEPS.length }}
              </span>
              <button
                type="button"
                class="cursor-pointer rounded text-3xs text-muted hover:text-default focus-visible:outline-2 focus-visible:outline-primary"
                @click="companion.endTour()"
              >
                Skip tour
              </button>
            </div>
            <p class="mt-1.5 text-xs font-semibold text-highlighted">{{ currentTourStep.title }}</p>
            <p class="mt-1 leading-relaxed text-default">{{ currentTourStep.body }}</p>
            <p class="mt-1.5 text-2xs text-muted">{{ currentTourStep.tip }}</p>
            <div class="mt-2.5 flex flex-wrap items-center justify-between gap-2">
              <UButton
                v-if="currentTourStep.action"
                size="xs"
                color="primary"
                variant="soft"
                :icon="currentTourStep.action.icon"
                @click="onActionClick(currentTourStep.action)"
              >
                {{ currentTourStep.action.label }}
              </UButton>
              <div class="ml-auto flex items-center gap-1">
                <UButton
                  v-if="companion.tourStep > 0"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  @click="companion.prevTourStep()"
                >
                  Back
                </UButton>
                <UButton size="xs" color="primary" @click="companion.nextTourStep()">
                  {{ companion.tourStep + 1 >= COMPANION_TOUR_STEPS.length ? 'Finish' : 'Next' }}
                </UButton>
              </div>
            </div>
          </div>

          <div
            v-if="companion.messages.length === 0 && !currentTourStep"
            class="my-auto flex flex-col items-center gap-3 py-4 text-center"
          >
            <div data-companion-hero>
              <CompanionAvatar
                :state="companion.effectiveAvatarState"
                :size="96"
                :prod="companion.isProd"
                live
              />
            </div>
            <div class="space-y-1">
              <p class="text-sm font-semibold text-highlighted">Hi! I'm your Ferry Companion.</p>
              <p class="max-w-xs text-xs leading-relaxed text-muted">
                Ask what's new after an update, find a Ferry feature, troubleshoot a transfer, or draft a bug report with private details removed. Works locally, no AI account needed.
              </p>
            </div>
            <div class="mt-1 flex w-full flex-col gap-1.5">
              <button
                v-for="starter in quickStarters"
                :key="starter.label"
                type="button"
                class="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-default bg-muted/30 px-3 py-2 text-left text-xs font-medium text-default transition-colors hover:border-primary/40 hover:bg-primary/8 focus-visible:outline-2 focus-visible:outline-primary"
                @click="onQuickStarter(starter.prompt)"
              >
                <UIcon :name="starter.icon" class="size-4 shrink-0 text-primary" />
                <span>{{ starter.label }}</span>
              </button>
            </div>
          </div>

          <div
            role="log"
            :aria-busy="companion.reveal !== null"
            aria-live="polite"
            aria-relevant="additions"
            class="flex flex-col gap-2.5"
            :class="companion.messages.length === 0 ? 'hidden' : ''"
          >
            <div
              v-for="msg in companion.messages"
              :key="msg.id"
              class="flex flex-col gap-1.5"
              :class="msg.role === 'user' ? 'items-end' : 'items-start'"
            >
              <div
                class="max-w-[92%] rounded-lg px-3 py-2 text-xs leading-relaxed"
                :class="
                  msg.role === 'user'
                    ? 'whitespace-pre-line bg-primary text-inverted'
                    : 'border border-default bg-muted/35 text-default'
                "
              >
                <template v-if="msg.role === 'assistant'">
                  <span class="sr-only">{{ msg.text }}</span>
                  <div aria-hidden="true" data-companion-md v-html="renderSafeChatMarkdown(displayText(msg))" />
                </template>
                <template v-else>{{ msg.text }}</template>
              </div>

              <template v-if="!isRevealing(msg)">

              <!-- Diagnosed Root Cause -->
              <div
                v-if="msg.rootCause"
                data-companion-root-cause
                class="w-full rounded-md border border-primary/25 bg-primary/8 px-2.5 py-2 text-2xs leading-relaxed text-default"
              >
                <span class="font-semibold text-primary">Root cause: </span>{{ msg.rootCause }}
              </div>

              <!-- Structured Risk-Badged Command Cards -->
              <div
                v-if="msg.commandCards && msg.commandCards.length > 0"
                class="flex w-full flex-col gap-2"
                data-companion-command-cards
              >
                <div
                  v-for="(card, cIdx) in msg.commandCards"
                  :key="card.command + cIdx"
                  class="rounded-lg border border-default bg-muted/30 p-2.5 text-xs"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="truncate text-2xs font-medium text-highlighted">{{ card.description }}</span>
                    <span
                      class="shrink-0 rounded-full px-1.5 py-0.5 font-mono text-3xs font-semibold"
                      :class="riskBadgeClass(card.risk)"
                    >
                      {{ riskBadgeLabel(card.risk) }}
                    </span>
                  </div>
                  <pre class="mt-1.5 overflow-x-auto rounded bg-default/80 px-2 py-1.5 font-mono text-2xs text-default select-text">{{ card.command }}</pre>
                  <div class="mt-2 flex flex-wrap items-center gap-1.5">
                    <UButton
                      size="xs"
                      :color="card.risk === 'destructive' ? 'error' : card.risk === 'mutating' ? 'warning' : 'primary'"
                      variant="soft"
                      icon="i-lucide-play"
                      data-run-command
                      @click="onRunCommandCard(card)"
                    >
                      Run in Terminal
                    </UButton>
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="outline"
                      icon="i-lucide-terminal"
                      data-insert-command
                      @click="onInsertCommand(card.command)"
                    >
                      Insert
                    </UButton>
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-copy"
                      @click="copyCommandText(card.command)"
                    >
                      Copy
                    </UButton>
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-bookmark-plus"
                      @click="saveCardAsSnippet(card)"
                    >
                      Save
                    </UButton>
                  </div>
                </div>
              </div>

              <!-- Structured UI Action Cards -->
              <div
                v-if="msg.uiActionCards && msg.uiActionCards.length > 0"
                class="flex flex-wrap gap-1.5"
                data-companion-ui-actions
              >
                <button
                  v-for="(uiAct, uIdx) in msg.uiActionCards"
                  :key="uiAct.kind + uiAct.label + uIdx"
                  type="button"
                  :title="uiActionCardTarget(uiAct)"
                  class="inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md border border-primary/35 bg-primary/10 px-2 py-1 text-2xs font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-primary"
                  @click="onUiActionCardClick(uiAct)"
                >
                  <UIcon :name="uiActionCardIcon(uiAct.kind)" class="size-3 shrink-0" />
                  <span class="shrink-0">{{ uiAct.label }}</span>
                  <code
                    v-if="uiActionCardTarget(uiAct)"
                    data-ui-action-target
                    class="truncate rounded bg-primary/10 px-1 font-mono text-3xs text-primary/90"
                  >{{ uiActionCardTarget(uiAct) }}</code>
                </button>
              </div>

              <!-- Structured What's New card -->
              <div
                v-if="msg.releaseCard"
                class="w-full rounded-lg border border-default bg-muted/25 p-3 text-xs"
              >
                <div class="flex items-center justify-between gap-2">
                  <p class="font-semibold text-highlighted">{{ msg.releaseCard.title }}</p>
                  <span class="rounded-full bg-primary/12 px-1.5 py-0.5 font-mono text-3xs font-medium text-primary">
                    v{{ msg.releaseCard.version }}
                  </span>
                </div>
                <ul class="mt-2 list-disc space-y-1 pl-4 text-muted">
                  <li v-for="item in msg.releaseCard.highlights" :key="item">
                    {{ item }}
                  </li>
                </ul>
                <p v-if="msg.releaseCard.source === 'bundled'" class="mt-2 text-3xs text-muted">
                  Showing bundled offline release notes.
                </p>
              </div>

              <!-- Action chips -->
              <div v-if="msg.actions && msg.actions.length > 0" class="flex flex-wrap gap-1.5">
                <button
                  v-for="act in msg.actions"
                  :key="act.id + act.label"
                  type="button"
                  class="inline-flex cursor-pointer items-center gap-1 rounded-md border border-default bg-default/80 px-2 py-1 text-2xs font-medium text-default transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                  @click="onActionClick(act)"
                >
                  <UIcon v-if="act.icon" :name="act.icon" class="size-3 shrink-0" />
                  <span>{{ act.label }}</span>
                </button>
              </div>

              <!-- Local-only response feedback & source badge -->
              <div v-if="msg.role === 'assistant'" class="flex items-center gap-1.5 px-0.5 text-3xs text-muted">
                <span v-if="msg.source === 'ai'" class="rounded bg-primary/12 px-1 py-0.2 font-mono text-primary">AI</span>
                <button
                  type="button"
                  aria-label="Mark reply helpful"
                  :aria-pressed="msg.feedback === 'helpful'"
                  class="inline-flex cursor-pointer items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-elevated hover:text-default"
                  :class="msg.feedback === 'helpful' ? 'text-primary' : ''"
                  @click="companion.setMessageFeedback(msg.id, 'helpful')"
                >
                  <UIcon name="i-lucide-thumbs-up" class="size-3" />
                </button>
                <button
                  type="button"
                  aria-label="Mark reply not helpful"
                  :aria-pressed="msg.feedback === 'not-helpful'"
                  class="inline-flex cursor-pointer items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-elevated hover:text-default"
                  :class="msg.feedback === 'not-helpful' ? 'text-warning' : ''"
                  @click="companion.setMessageFeedback(msg.id, 'not-helpful')"
                >
                  <UIcon name="i-lucide-thumbs-down" class="size-3" />
                </button>
              </div>
              </template>
            </div>
            <div v-if="companion.aiBusy" class="flex items-center justify-between gap-2 text-xs text-muted">
              <div class="flex items-center gap-1.5">
                <UIcon name="i-lucide-loader-2" class="size-3.5 animate-spin text-primary motion-reduce:animate-none" />
                <span>Thinking…</span>
              </div>
              <UButton
                size="xs"
                color="neutral"
                variant="soft"
                icon="i-lucide-square"
                data-stop-ai
                @click="onStopAi"
              >
                Stop
              </UButton>
            </div>
          </div>
        </div>

        <!-- SNIPPETS & COMMAND HISTORY VIEW -->
        <div v-else-if="companion.activeView === 'snippets'" class="flex flex-col gap-3" data-companion-snippets>
          <div class="flex items-center gap-1.5">
            <input
              v-model="snippetFilter"
              type="text"
              aria-label="Search snippets"
              placeholder="Filter local snippets…"
              class="min-w-0 flex-1 rounded-md border border-default bg-default/70 px-2.5 py-1 text-xs text-default placeholder:text-muted focus:border-primary focus:outline-none"
            />
            <UButton
              size="xs"
              color="primary"
              variant="soft"
              :icon="showSnippetForm ? 'i-lucide-x' : 'i-lucide-plus'"
              @click="toggleNewSnippetForm"
            >
              {{ showSnippetForm ? 'Cancel' : 'New' }}
            </UButton>
          </div>

          <form
            v-if="showSnippetForm"
            class="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-xs"
            @submit.prevent="onCreateSnippet"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold text-highlighted">
                {{ editingSnippetId ? 'Edit Local Snippet' : 'Save Local Snippet' }}
              </span>
              <span
                v-if="newSnippetCommand.trim()"
                class="rounded-full px-1.5 py-0.5 font-mono text-3xs font-semibold"
                :class="riskBadgeClass(draftSnippetRisk)"
              >
                {{ riskBadgeLabel(draftSnippetRisk) }}
              </span>
            </div>
            <div class="flex items-center gap-1.5">
              <input
                v-model="aiSnippetPrompt"
                type="text"
                aria-label="Draft snippet with AI"
                placeholder="Draft with AI (e.g. tail {{service}} logs)…"
                class="min-w-0 flex-1 rounded border border-default bg-default/80 px-2 py-1 text-2xs text-default"
              />
              <UButton
                type="button"
                size="xs"
                color="neutral"
                variant="outline"
                icon="i-lucide-sparkles"
                :loading="aiSnippetDrafting"
                :disabled="!aiSnippetPrompt.trim()"
                @click="draftSnippetWithAi"
              >
                Draft
              </UButton>
            </div>
            <input
              v-model="newSnippetLabel"
              type="text"
              aria-label="Snippet label"
              placeholder="Label (e.g. Check nginx config)"
              class="rounded border border-default bg-default/80 px-2 py-1 text-xs text-default"
            />
            <input
              v-model="newSnippetCommand"
              type="text"
              aria-label="Snippet command"
              placeholder="Shell command (supports {{service}}, {{path}})"
              class="rounded border border-default bg-default/80 px-2 py-1 font-mono text-xs text-default"
            />
            <input
              v-model="newSnippetDescription"
              type="text"
              aria-label="Snippet description"
              placeholder="Optional note"
              class="rounded border border-default bg-default/80 px-2 py-1 text-xs text-default"
            />
            <div class="flex justify-end">
              <UButton
                type="submit"
                size="xs"
                color="primary"
                :disabled="!newSnippetLabel.trim() || !newSnippetCommand.trim()"
              >
                {{ editingSnippetId ? 'Update Snippet' : 'Save Snippet' }}
              </UButton>
            </div>
          </form>

          <!-- Inline {{param}} prompt for parameterized snippets -->
          <div
            v-if="pendingParamSnippet"
            data-snippet-param-prompt
            class="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/8 p-2.5 text-xs"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold text-highlighted">Fill parameters · {{ pendingParamSnippet.snippet.label }}</span>
              <button
                type="button"
                class="cursor-pointer text-2xs text-muted hover:text-default"
                @click="pendingParamSnippet = null"
              >
                Cancel
              </button>
            </div>
            <label v-for="param in pendingParamSnippet.params" :key="param" class="flex flex-col gap-0.5 text-2xs">
              <span class="font-mono text-muted">{{ param }}</span>
              <input
                v-model="pendingParamSnippet.values[param]"
                type="text"
                class="rounded border border-default bg-default px-2 py-1 font-mono text-2xs text-default"
              />
            </label>
            <pre class="overflow-x-auto rounded bg-default px-2 py-1 font-mono text-2xs text-default">{{ resolvedParamSnippetCommand }}</pre>
            <div class="flex justify-end gap-1.5">
              <UButton size="xs" color="primary" :disabled="!resolvedParamSnippetCommand" @click="submitParamSnippet">
                {{ pendingParamSnippet.action === 'run' ? 'Continue to Run' : 'Insert in Terminal' }}
              </UButton>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <div
              v-for="snip in filteredSnippets"
              :key="snip.id"
              class="rounded-lg border border-default bg-muted/25 p-2.5 text-xs"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="truncate font-semibold text-highlighted">{{ snip.label }}</span>
                <div class="flex shrink-0 items-center gap-1">
                  <span
                    class="rounded-full px-1.5 py-0.5 font-mono text-3xs font-semibold"
                    :class="riskBadgeClass(snip.risk)"
                  >
                    {{ riskBadgeLabel(snip.risk) }}
                  </span>
                  <button
                    v-if="!snip.builtIn"
                    type="button"
                    aria-label="Edit snippet"
                    class="cursor-pointer rounded p-0.5 text-muted hover:text-primary"
                    @click="startEditSnippet(snip)"
                  >
                    <UIcon name="i-lucide-pencil" class="size-3" />
                  </button>
                  <button
                    v-if="!snip.builtIn"
                    type="button"
                    aria-label="Delete snippet"
                    class="cursor-pointer rounded p-0.5 text-muted hover:text-error"
                    @click="companion.deleteCustomSnippet(snip.id)"
                  >
                    <UIcon name="i-lucide-trash-2" class="size-3" />
                  </button>
                </div>
              </div>
              <pre class="mt-1.5 overflow-x-auto rounded bg-default/80 px-2 py-1 font-mono text-2xs text-default select-text">{{ snip.command }}</pre>
              <p v-if="snip.description" class="mt-1 text-2xs text-muted">{{ snip.description }}</p>
              <div class="mt-2 flex flex-wrap items-center gap-1.5">
                <UButton
                  size="xs"
                  color="primary"
                  variant="soft"
                  icon="i-lucide-play"
                  @click="invokeSnippetAction(snip, 'run')"
                >
                  Run in Terminal
                </UButton>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-terminal"
                  data-insert-command
                  @click="invokeSnippetAction(snip, 'insert')"
                >
                  Insert
                </UButton>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-copy"
                  @click="copyCommandText(snip.command)"
                >
                  Copy
                </UButton>
              </div>
            </div>
            <p v-if="filteredSnippets.length === 0" class="py-3 text-center text-xs text-muted">
              No snippets match "{{ snippetFilter }}".
            </p>
          </div>

          <div v-if="companion.commandHistory.length > 0" class="border-t border-muted pt-3">
            <div class="mb-2 flex items-center justify-between gap-2">
              <p class="text-2xs font-semibold text-muted">Recent Command History</p>
              <button
                type="button"
                class="cursor-pointer text-3xs text-muted hover:text-default"
                @click="companion.clearCommandHistory()"
              >
                Clear
              </button>
            </div>
            <div class="flex flex-col gap-1.5">
              <div
                v-for="item in companion.commandHistory.slice(0, 10)"
                :key="item.id"
                class="flex items-center justify-between gap-2 rounded border border-default/70 bg-muted/15 px-2 py-1.5 text-2xs"
              >
                <div class="min-w-0 flex-1">
                  <code class="block truncate font-mono text-default">{{ item.command }}</code>
                  <span v-if="item.hostLabel" class="text-3xs text-muted">{{ item.hostLabel }}</span>
                </div>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-play"
                  aria-label="Re-run command"
                  @click="onRunCommandCard({ command: item.command, description: 'Re-run from history', risk: item.risk })"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- WHAT'S NEW VIEW -->
        <div v-else-if="companion.activeView === 'whats-new'" class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-2">
            <p class="text-xs font-semibold text-highlighted">
              Installed:
              <span class="font-mono text-primary">
                {{ companion.currentVersion ? `v${companion.currentVersion}` : 'Unknown' }}
              </span>
            </p>
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-refresh-cw"
              :loading="companion.releasesLoading"
              @click="companion.ensureReleasesLoaded(true)"
            >
              Refresh
            </UButton>
          </div>

          <div
            v-if="companion.releasesLoading && !currentRelease"
            class="flex items-center gap-2 rounded-lg border border-default bg-muted/25 p-3 text-xs text-muted"
          >
            <UIcon name="i-lucide-loader-2" class="size-4 animate-spin text-primary motion-reduce:animate-none" />
            <span>Loading official release notes…</span>
          </div>

          <div v-else-if="currentRelease" class="rounded-lg border border-default bg-muted/25 p-3 text-xs">
            <div class="flex items-center justify-between gap-2">
              <p class="font-semibold text-highlighted">{{ currentRelease.title }}</p>
              <span class="rounded-full bg-primary/12 px-2 py-0.5 font-mono text-3xs text-primary">
                {{ currentRelease.source === 'github' ? 'Official' : 'Offline' }}
              </span>
            </div>
            <p
              v-if="companion.currentVersion && currentRelease.version !== companion.currentVersion"
              class="mt-1.5 text-2xs text-muted"
            >
              Showing latest available notes (v{{ currentRelease.version }}); notes for v{{ companion.currentVersion }} aren't published yet.
            </p>
            <ul class="mt-2 list-disc space-y-1.5 pl-4 text-muted">
              <li v-for="item in currentRelease.highlights" :key="item">
                {{ item }}
              </li>
            </ul>
            <div class="mt-3 flex flex-wrap items-center gap-1.5">
              <UButton size="xs" color="primary" variant="soft" icon="i-lucide-compass" @click="onQuickStarter('Help me use Ferry')">
                Show me around
              </UButton>
              <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-external-link" @click="openFullNotes(currentRelease.url)">
                Full release notes
              </UButton>
              <UButton
                v-if="!companion.dismissedVersions.includes(currentRelease.version)"
                size="xs"
                color="neutral"
                variant="ghost"
                @click="companion.dismissVersion(currentRelease.version)"
              >
                Dismiss
              </UButton>
            </div>
          </div>

          <div
            v-else
            class="flex flex-col items-start gap-2 rounded-lg border border-default bg-muted/20 p-3 text-xs text-muted"
          >
            <p>Release notes are currently unavailable.</p>
            <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-external-link" @click="openFullNotes()">
              Open ferry-release on GitHub
            </UButton>
          </div>

          <div v-if="otherReleases.length > 0" class="flex flex-col gap-2">
            <p class="text-2xs font-medium text-muted">Previous releases</p>
            <div
              v-for="rel in otherReleases"
              :key="rel.version"
              class="rounded-md border border-default/70 bg-muted/15 p-2.5 text-xs"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="font-mono font-medium text-default">v{{ rel.version }}</span>
                <button
                  type="button"
                  :aria-label="`Open release notes for v${rel.version} in browser`"
                  class="cursor-pointer rounded text-3xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                  @click="openFullNotes(rel.url)"
                >
                  Notes
                </button>
              </div>
              <ul v-if="rel.highlights.length > 0" class="mt-1 list-disc space-y-0.5 pl-4 text-2xs text-muted">
                <li v-for="item in rel.highlights.slice(0, 3)" :key="item">
                  {{ item }}
                </li>
              </ul>
            </div>
          </div>
        </div>

        <!-- REPORT ISSUE VIEW (kept mounted with v-show so draft text survives tab switches) -->
        <CompanionIssueForm v-show="companion.activeView === 'report'" />

        <!-- ANNOUNCEMENTS HISTORY VIEW -->
        <div v-if="companion.activeView === 'history'" class="flex flex-col gap-2">
          <p class="text-xs text-muted">Recent release announcements and companion notices from this session.</p>
          <div
            v-if="companion.announcements.length === 0"
            class="rounded-lg border border-default/70 bg-muted/20 p-4 text-center text-xs text-muted"
          >
            No announcements yet.
          </div>
          <div
            v-for="ann in companion.announcements"
            :key="ann.id"
            class="rounded-lg border border-default/80 bg-muted/20 p-2.5 text-xs"
          >
            <div class="flex items-center justify-between gap-2">
              <p class="font-medium text-highlighted">{{ ann.title }}</p>
              <span v-if="ann.version" class="font-mono text-3xs text-primary">v{{ ann.version }}</span>
            </div>
            <p class="mt-1 text-2xs text-muted">{{ ann.body }}</p>
          </div>
        </div>
      </div>

      <!-- Shared action feedback status (visible across Chat, Snippets, etc.) -->
      <p
        role="status"
        aria-live="polite"
        class="border-t border-muted/60 px-3 py-1 text-3xs text-muted"
        :class="actionFeedback ? '' : 'sr-only'"
      >
        {{ actionFeedback ?? '' }}
      </p>

      <!-- Footer input (Chat view) -->
      <form
        v-if="companion.activeView === 'chat'"
        class="flex items-center gap-1.5 border-t border-muted p-2.5"
        @submit.prevent="onSend"
      >
        <input
          ref="inputRef"
          v-model="draftInput"
          type="text"
          @focus="inputFocused = true"
          @blur="inputFocused = false"
          aria-label="Ask Ferry Companion"
          placeholder="Ask what's new, how to use Ferry, or report a bug…"
          class="min-w-0 flex-1 rounded-md border border-default bg-default/70 px-2.5 py-1.5 text-xs text-default placeholder:text-muted focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
        <UButton
          v-if="companion.aiBusy"
          type="button"
          size="xs"
          color="neutral"
          variant="soft"
          icon="i-lucide-square"
          aria-label="Stop response"
          data-stop-ai-footer
          @click="onStopAi"
        />
        <UButton
          v-else
          type="submit"
          size="xs"
          color="primary"
          icon="i-lucide-send"
          aria-label="Send message"
          :disabled="!draftInput.trim()"
        />
      </form>
    </aside>
  </Transition>
  </Teleport>

  <!-- Run in Terminal Confirmation Modal -->
  <UModal
    v-model:open="runConfirmOpen"
    :title="`Run command on ${activeHostLabel}?`"
    :ui="{ overlay: 'z-[70]', content: 'z-[70] max-w-md', footer: 'justify-end' }"
  >
    <template #body>
      <div v-if="pendingRunCard" class="flex flex-col gap-3">
        <div
          v-if="companion.isProd"
          role="alert"
          data-prod-warning-banner
          class="flex items-start gap-2 rounded-md border border-error/50 bg-error/15 px-3 py-2 text-xs text-error"
        >
          <UIcon name="i-lucide-shield-alert" class="mt-0.5 size-4 shrink-0" />
          <div>
            <p class="font-semibold">Production Environment</p>
            <p class="mt-0.5 text-2xs">
              You are connected to {{ companion.prodSiteLabel || activeHostLabel }}. Verify this command carefully before executing.
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2 text-xs">
          <span
            class="rounded-full px-1.5 py-0.5 font-mono text-3xs font-semibold"
            :class="riskBadgeClass(pendingRunRisk)"
          >
            {{ riskBadgeLabel(pendingRunRisk) }}
          </span>
          <span class="text-muted">
            {{
              pendingRunRisk === 'destructive'
                ? 'Can delete data or interrupt services.'
                : pendingRunRisk === 'mutating'
                  ? 'Modifies files or service state.'
                  : 'Inspects remote state without modifying files.'
            }}
          </span>
        </div>
        <pre class="max-h-48 overflow-auto rounded-md bg-muted p-2.5 font-mono text-xs text-default select-text">{{ pendingRunCard.command }}</pre>
      </div>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" @click="pendingRunCard = null">Cancel</UButton>
      <UButton
        :color="pendingRunRisk === 'destructive' ? 'error' : pendingRunRisk === 'mutating' ? 'warning' : 'primary'"
        data-confirm-run-command
        @click="confirmPendingRunCommand"
      >
        Run in Terminal
      </UButton>
    </template>
  </UModal>
</template>
