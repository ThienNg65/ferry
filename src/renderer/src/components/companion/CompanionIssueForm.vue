<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { openExternal } from '../../bridge/neutralinoApi'
import { useCompanionStore } from '../../stores/companion.store'
import { useUiStore } from '../../stores/ui.store'
import {
  buildGitHubIssueDraft,
  type IssueCategory,
  type IssueDraftForm
} from '../../utils/companionPrivacy'

const companion = useCompanionStore()
const ui = useUiStore()

const step = ref<'draft' | 'review'>('draft')
const submitting = ref(false)
const submitOutcome = ref<{ kind: 'opened' | 'error'; message: string } | null>(null)
const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null
const titleInputRef = ref<HTMLInputElement | null>(null)
const reviewHeadingRef = ref<HTMLParagraphElement | null>(null)
const radioGroupRef = ref<HTMLDivElement | null>(null)

const form = ref<IssueDraftForm>({
  category: companion.reportCategory,
  title: '',
  details: '',
  expected: '',
  actual: '',
  includeDiagnostics: false
})

watch(
  () => companion.reportCategory,
  (cat) => {
    form.value.category = cat
  }
)

const categories: { id: IssueCategory; label: string; icon: string }[] = [
  { id: 'bug', label: 'Bug', icon: 'i-lucide-bug' },
  { id: 'feature', label: 'Feature', icon: 'i-lucide-lightbulb' },
  { id: 'feedback', label: 'Feedback', icon: 'i-lucide-message-square' }
]

const platformLabel = computed(() => {
  if (typeof navigator === 'undefined') return 'Desktop'
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Mac/i.test(ua)) return 'macOS'
  if (/Linux/i.test(ua)) return 'Linux'
  return 'Desktop'
})

const canReview = computed(() => form.value.title.trim().length >= 3 && form.value.details.trim().length >= 5)

const builtDraft = computed(() =>
  buildGitHubIssueDraft(form.value, {
    appVersion: companion.currentVersion || 'unknown',
    platform: platformLabel.value,
    dockPosition: ui.dockPosition,
    theme: `${ui.theme}${ui.glassUiEnabled ? ' (Glass)' : ' (Classic)'}`,
    lastErrorSummary: companion.lastTransferError
  })
)

function goToReview(): void {
  if (!canReview.value) return
  submitOutcome.value = null
  step.value = 'review'
  void nextTick(() => reviewHeadingRef.value?.focus())
}

function goToDraft(): void {
  step.value = 'draft'
  void nextTick(() => titleInputRef.value?.focus())
}

function onRadioGroupKeydown(e: KeyboardEvent): void {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']
  if (!keys.includes(e.key)) return
  e.preventDefault()
  const idx = categories.findIndex((c) => c.id === form.value.category)
  const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
  const next = (idx + delta + categories.length) % categories.length
  form.value.category = categories[next].id
  const buttons = radioGroupRef.value?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
  buttons?.[next]?.focus()
}

async function copyMarkdown(): Promise<boolean> {
  if (copyTimer) {
    clearTimeout(copyTimer)
    copyTimer = null
  }
  try {
    await navigator.clipboard.writeText(builtDraft.value.markdown)
    copied.value = true
    copyTimer = setTimeout(() => {
      copied.value = false
      copyTimer = null
    }, 2000)
    return true
  } catch {
    copied.value = false
    return false
  }
}

onBeforeUnmount(() => {
  if (copyTimer) {
    clearTimeout(copyTimer)
    copyTimer = null
  }
})

async function submitToGitHub(): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  submitOutcome.value = null

  try {
    const clipboardOk = builtDraft.value.truncatedForUrl ? await copyMarkdown() : false
    await openExternal(builtDraft.value.url)
    submitOutcome.value = {
      kind: 'opened',
      message: builtDraft.value.truncatedForUrl
        ? clipboardOk
          ? 'Opened GitHub in your browser and copied the full markdown to your clipboard. Paste and submit on GitHub to create the public issue.'
          : 'Opened GitHub in your browser, but automatic clipboard copy failed. Click "Copy markdown" below and paste it on GitHub.'
        : 'Opened a prefilled draft on ferry-release in your browser. Review and click "Submit new issue" on GitHub to create the ticket.'
    }
  } catch (err) {
    submitOutcome.value = {
      kind: 'error',
      message: `Could not open your browser automatically (${err instanceof Error ? err.message : 'unknown error'}). Use "Copy markdown" below and paste it at github.com/ThienNg65/ferry-release/issues/new.`
    }
  } finally {
    submitting.value = false
  }
}

function resetForm(): void {
  form.value = {
    category: companion.reportCategory,
    title: '',
    details: '',
    expected: '',
    actual: '',
    includeDiagnostics: false
  }
  step.value = 'draft'
  submitOutcome.value = null
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-if="step === 'draft'" class="flex flex-col gap-3">
      <p class="text-xs text-muted">
        Draft an issue for the public <span class="font-medium text-default">ferry-release</span> tracker. Nothing is sent until you review the redacted preview.
      </p>

      <div
        ref="radioGroupRef"
        class="grid grid-cols-3 gap-1"
        role="radiogroup"
        aria-label="Report category"
        @keydown="onRadioGroupKeydown"
      >
        <button
          v-for="cat in categories"
          :key="cat.id"
          type="button"
          role="radio"
          :aria-checked="form.category === cat.id"
          :tabindex="form.category === cat.id ? 0 : -1"
          class="flex cursor-pointer items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary"
          :class="
            form.category === cat.id
              ? 'border-primary bg-primary/12 text-primary'
              : 'border-default text-muted hover:bg-elevated hover:text-default'
          "
          @click="form.category = cat.id"
        >
          <UIcon :name="cat.icon" class="size-3.5" />
          <span>{{ cat.label }}</span>
        </button>
      </div>

      <label class="flex flex-col gap-1">
        <span class="text-xs font-medium text-default">Title</span>
        <input
          ref="titleInputRef"
          v-model="form.title"
          type="text"
          maxlength="140"
          placeholder="Short summary of the issue or idea"
          class="rounded-md border border-default bg-default/70 px-2.5 py-1.5 text-xs text-default placeholder:text-muted focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-xs font-medium text-default">
          {{ form.category === 'bug' ? 'Steps to reproduce' : 'Details' }}
        </span>
        <textarea
          v-model="form.details"
          rows="3"
          placeholder="Describe what happened or what you'd like to see…"
          class="resize-y rounded-md border border-default bg-default/70 px-2.5 py-1.5 text-xs text-default placeholder:text-muted focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
      </label>

      <template v-if="form.category === 'bug'">
        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-default">Expected result <span class="font-normal text-muted">(optional)</span></span>
          <input
            v-model="form.expected"
            type="text"
            placeholder="What you expected Ferry to do"
            class="rounded-md border border-default bg-default/70 px-2.5 py-1.5 text-xs text-default placeholder:text-muted focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-default">Actual result <span class="font-normal text-muted">(optional)</span></span>
          <input
            v-model="form.actual"
            type="text"
            placeholder="What happened instead"
            class="rounded-md border border-default bg-default/70 px-2.5 py-1.5 text-xs text-default placeholder:text-muted focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          />
        </label>
      </template>

      <label class="flex items-start gap-2 rounded-md border border-default/80 bg-muted/30 p-2 text-xs cursor-pointer">
        <input
          v-model="form.includeDiagnostics"
          type="checkbox"
          class="mt-0.5 rounded border-default accent-primary focus:ring-primary"
        />
        <span class="text-muted">
          <span class="font-medium text-default">Include optional sanitized diagnostics</span>
          (dock layout, theme{{ companion.lastTransferError ? ', and redacted last transfer error' : '' }}). No logs, credentials, or file contents are ever attached.
        </span>
      </label>

      <div class="flex items-center justify-end gap-2 pt-1">
        <UButton size="xs" color="neutral" variant="ghost" @click="companion.activeView = 'chat'">
          Cancel
        </UButton>
        <UButton size="xs" color="primary" :disabled="!canReview" @click="goToReview">
          Review privacy & preview
        </UButton>
      </div>
    </div>

    <div v-else class="flex flex-col gap-3">
      <div class="flex items-start gap-2 rounded-md border border-default bg-muted/30 p-2.5 text-xs">
        <UIcon name="i-lucide-shield-check" class="mt-0.5 size-4 shrink-0 text-primary" />
        <div class="min-w-0">
          <p ref="reviewHeadingRef" tabindex="-1" class="font-medium text-default focus:outline-none">Privacy review</p>
          <p v-if="builtDraft.redactionCount > 0" class="mt-0.5 text-muted">
            Automatically redacted {{ builtDraft.redactionCount }} item{{ builtDraft.redactionCount === 1 ? '' : 's' }} ({{ builtDraft.redactedCategories.join(', ') }}). Please double-check before posting publicly.
          </p>
          <p v-else class="mt-0.5 text-muted">
            No obvious secrets, IPs, or local user paths detected. Please confirm nothing private appears below.
          </p>
        </div>
      </div>

      <div class="rounded-md border border-default bg-muted/20 p-2.5">
        <p class="text-xs font-semibold text-highlighted">{{ builtDraft.title }}</p>
        <pre class="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed text-default">{{ builtDraft.markdown }}</pre>
      </div>

      <div
        v-if="submitOutcome"
        role="status"
        aria-live="polite"
        class="rounded-md border p-2.5 text-xs"
        :class="
          submitOutcome.kind === 'opened'
            ? 'border-success/40 bg-success/10 text-default'
            : 'border-error/40 bg-error/10 text-default'
        "
      >
        {{ submitOutcome.message }}
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
        <UButton size="xs" color="neutral" variant="ghost" @click="goToDraft">
          Edit draft
        </UButton>
        <div class="flex items-center gap-1.5">
          <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-copy" @click="copyMarkdown">
            {{ copied ? 'Copied' : 'Copy markdown' }}
          </UButton>
          <UButton
            size="xs"
            color="primary"
            icon="i-lucide-external-link"
            :loading="submitting"
            :disabled="submitting"
            @click="submitToGitHub"
          >
            Open on GitHub
          </UButton>
        </div>
      </div>

      <div v-if="submitOutcome?.kind === 'opened'" class="flex justify-end">
        <UButton size="xs" color="neutral" variant="link" @click="resetForm">
          Start another report
        </UButton>
      </div>
    </div>
  </div>
</template>
