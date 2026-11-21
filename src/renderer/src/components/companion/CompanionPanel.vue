<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Popover from '@nuxt/ui/components/Popover.vue'
import USwitch from '@nuxt/ui/components/Switch.vue'
import { openExternal } from '../../bridge/neutralinoApi'
import { useCompanionStore, type CompanionView } from '../../stores/companion.store'
import { useSessionsStore } from '../../stores/sessions.store'
import { useUiStore } from '../../stores/ui.store'
import { OFFICIAL_RELEASES_URL } from '../../utils/companionChangelogFallback'
import type { CompanionActionChip } from '../../utils/companionEngine'
import { COMPANION_TOUR_STEPS } from '../../utils/companionTour'
import { onTablistKeydown } from '../../utils/tablistKeys'
import CompanionAvatar from './CompanionAvatar.vue'
import CompanionIssueForm from './CompanionIssueForm.vue'

const companion = useCompanionStore()
const sessions = useSessionsStore()
const ui = useUiStore()

const draftInput = ref('')
const panelRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const scrollContainerRef = ref<HTMLElement | null>(null)
const actionFeedback = ref<string | null>(null)
const prefsOpen = ref(false)
let previouslyFocused: HTMLElement | null = null

const currentTourStep = computed(() =>
  companion.tourStep !== null ? (COMPANION_TOUR_STEPS[companion.tourStep] ?? null) : null
)

const views: { id: CompanionView; label: string; icon: string }[] = [
  { id: 'chat', label: 'Chat', icon: 'i-lucide-message-circle' },
  { id: 'whats-new', label: "What's New", icon: 'i-lucide-sparkles' },
  { id: 'report', label: 'Report', icon: 'i-lucide-bug' },
  { id: 'history', label: 'Updates', icon: 'i-lucide-bell' }
]

const quickStarters = computed(() => {
  const items: Array<{ label: string; prompt: string; icon: string }> = []
  if (companion.lastTransferError) {
    items.push({
      label: 'Investigate failed transfer',
      prompt: 'Help me troubleshoot the failed transfer',
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
  (isOpen) => {
    if (isOpen) {
      const active = document.activeElement
      if (
        active instanceof HTMLElement &&
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
    } else {
      const target = previouslyFocused
      previouslyFocused = null
      if (target && target.isConnected) {
        target.focus()
      } else {
        const fallback = document.querySelector<HTMLElement>('[data-pane] [tabindex="0"], main [tabindex="0"]')
        fallback?.focus()
      }
    }
  },
  { immediate: true }
)

watch(
  () => companion.messages.length,
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
  }
)

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented || !companion.open) return
  if (prefsOpen.value) {
    e.preventDefault()
    e.stopPropagation()
    prefsOpen.value = false
    return
  }
  if (document.querySelector('[role="dialog"]:not([data-state="closed"])')) {
    return
  }
  e.preventDefault()
  e.stopPropagation()
  companion.closePanel()
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))

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

function openFullNotes(url?: string): void {
  void openExternal(url || OFFICIAL_RELEASES_URL).catch(() => {})
}
</script>

<template>
  <Transition name="slide-right">
    <aside
      v-if="companion.open"
      ref="panelRef"
      tabindex="-1"
      role="complementary"
      aria-label="Ferry Companion"
      class="fixed top-9 right-0 bottom-0 z-40 flex w-[380px] max-w-[calc(100vw-0.5rem)] flex-col border-l border-default shadow-xl focus:outline-none"
      :class="
        ui.glassUiEnabled
          ? 'ferry-glass-overlay rounded-l-[var(--ferry-radius-overlay)] rounded-r-none border-r-0 border-b-0'
          : 'bg-default'
      "
      data-companion-panel
    >
      <!-- Header -->
      <div class="flex items-center justify-between gap-2 border-b border-muted px-3 py-2 select-none">
        <div class="flex min-w-0 items-center gap-2">
          <CompanionAvatar :state="companion.effectiveAvatarState" :size="20" class="text-primary" />
          <div class="min-w-0">
            <h2 class="truncate text-xs font-semibold text-highlighted">Ferry Companion</h2>
            <p class="truncate text-3xs text-muted">
              {{ companion.quietMode ? 'Quiet Mode on' : 'A little friend who knows your workspace' }}
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
          class="inline-flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary"
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
            <div class="rounded-full bg-primary/10 p-3 ring-1 ring-primary/20">
              <CompanionAvatar state="resting" :size="30" class="text-primary" />
            </div>
            <div class="space-y-1">
              <p class="text-sm font-semibold text-highlighted">Hi! I'm your Ferry Companion.</p>
              <p class="max-w-xs text-xs leading-relaxed text-muted">
                Ask what's new after an update, jump straight to a Ferry feature, troubleshoot a transfer, or draft a privacy-checked bug report — all locally, no AI account needed.
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
                class="max-w-[92%] rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-line"
                :class="
                  msg.role === 'user'
                    ? 'bg-primary text-inverted'
                    : 'border border-default bg-muted/35 text-default'
                "
              >
                {{ msg.text }}
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
            </div>
            <div v-if="companion.aiBusy" class="flex items-center gap-1.5 text-xs text-muted">
              <UIcon name="i-lucide-loader-2" class="size-3.5 animate-spin text-primary motion-reduce:animate-none" />
              <span>Thinking…</span>
            </div>
          </div>

          <p role="status" aria-live="polite" class="text-3xs text-muted" :class="actionFeedback ? '' : 'sr-only'">
            {{ actionFeedback ?? '' }}
          </p>
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
          aria-label="Ask Ferry Companion"
          placeholder="Ask what's new, how to use Ferry, or report a bug…"
          class="min-w-0 flex-1 rounded-md border border-default bg-default/70 px-2.5 py-1.5 text-xs text-default placeholder:text-muted focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
        <UButton
          type="submit"
          size="xs"
          color="primary"
          icon="i-lucide-send"
          aria-label="Send message"
          :loading="companion.aiBusy"
          :disabled="!draftInput.trim() || companion.aiBusy"
        />
      </form>
    </aside>
  </Transition>
</template>
