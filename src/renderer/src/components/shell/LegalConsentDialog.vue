<script setup lang="ts">
import { ref, watch } from 'vue'
import { LEGAL_POLICY_VERSION } from '@shared/contract'
import privacyMarkdown from '../../../../../PRIVACY.md?raw'
import termsMarkdown from '../../../../../TERMS.md?raw'
import { useSettingsStore } from '../../stores/settings.store'
import { useNotify } from '../../composables/useNotify'
import { onTablistKeydown } from '../../utils/tablistKeys'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ accepted: [] }>()

const settings = useSettingsStore()
const notify = useNotify()

const acceptedCheckbox = ref(false)
const autoUpdates = ref(true)
const activeDoc = ref<'summary' | 'privacy' | 'terms'>('summary')
const saving = ref(false)

const docTabs: { id: 'summary' | 'privacy' | 'terms'; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'privacy', label: 'Privacy Policy' },
  { id: 'terms', label: 'Terms of Service' }
]

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    acceptedCheckbox.value = false
    autoUpdates.value = settings.autoCheckUpdates
    activeDoc.value = 'summary'
  }
)

async function onContinue(): Promise<void> {
  if (!acceptedCheckbox.value || saving.value) return
  saving.value = true
  try {
    if (autoUpdates.value !== settings.autoCheckUpdates) {
      await settings.setAutoCheckUpdates(autoUpdates.value)
    }
    await settings.acceptTerms(LEGAL_POLICY_VERSION)
    emit('accepted')
  } catch (err) {
    notify.error('Could not save acceptance', err instanceof Error ? err.message : String(err))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :dismissible="false"
    :close="false"
    title="Privacy Policy & Terms of Service"
    description="Please review and accept Ferry's Privacy Policy and Terms of Service before continuing."
    :ui="{ content: 'max-w-xl' }"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <div
          class="flex gap-1 border-b border-muted pb-2"
          role="tablist"
          aria-label="Legal documents"
          @keydown="onTablistKeydown($event, true)"
        >
          <button
            v-for="tab in docTabs"
            :id="`legal-tab-${tab.id}`"
            :key="tab.id"
            type="button"
            role="tab"
            :aria-selected="activeDoc === tab.id"
            :aria-controls="`legal-panel-${tab.id}`"
            :tabindex="activeDoc === tab.id ? 0 : -1"
            class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary"
            :class="activeDoc === tab.id ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-muted'"
            @click="activeDoc = tab.id"
          >
            {{ tab.label }}
          </button>
        </div>

        <div
          v-if="activeDoc === 'summary'"
          id="legal-panel-summary"
          role="tabpanel"
          aria-labelledby="legal-tab-summary"
          class="flex flex-col gap-2 text-sm text-default"
        >
          <p>
            Ferry is a free, MIT-licensed desktop SFTP client. Your site configurations, credentials (encrypted via
            Windows DPAPI), bookmarks, and history stay locally on your device.
          </p>
          <ul class="list-disc space-y-1 pl-5 text-xs text-muted">
            <li>Zero analytics, cookies, tracking SDKs, ads, or AI training on your data.</li>
            <li>Outbound connections are made only to SSH/SFTP/proxy hosts you configure and, if enabled below, GitHub Releases for app updates.</li>
            <li>You can export or delete all local data and adjust history retention anytime in <strong>Settings → Privacy &amp; Legal</strong>.</li>
          </ul>
        </div>
        <pre
          v-else
          :id="`legal-panel-${activeDoc}`"
          role="tabpanel"
          :aria-labelledby="`legal-tab-${activeDoc}`"
          class="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-md border border-muted bg-elevated p-3 font-sans text-xs text-default"
        >{{ activeDoc === 'privacy' ? privacyMarkdown : termsMarkdown }}</pre>

        <div class="flex items-center justify-between rounded-md border border-muted bg-elevated/50 px-3 py-2">
          <div class="min-w-0 pr-3">
            <div class="text-xs font-medium text-highlighted">Automatically check for updates</div>
            <div class="text-xs text-muted">Connects to GitHub Releases (ThienNg65/ferry-release) to check for new versions.</div>
          </div>
          <USwitch v-model="autoUpdates" aria-label="Automatically check for updates" />
        </div>

        <UCheckbox
          v-model="acceptedCheckbox"
          :label="`I have read and accept the Privacy Policy and Terms of Service (v${LEGAL_POLICY_VERSION})`"
        />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end">
        <UButton :disabled="!acceptedCheckbox" :loading="saving" @click="onContinue">
          Accept &amp; Continue
        </UButton>
      </div>
    </template>
  </UModal>
</template>
