<script setup lang="ts">
import { ref, watch } from 'vue'
import { useSessionsStore } from '../../stores/sessions.store'
import PasswordInput from '../shell/PasswordInput.vue'

const sessions = useSessionsStore()

const copiedFingerprint = ref(false)
async function copyFingerprint(): Promise<void> {
  const fp = sessions.pendingHostKeyPrompt?.fingerprint
  if (!fp) return
  try {
    await navigator.clipboard.writeText(fp)
    copiedFingerprint.value = true
    setTimeout(() => { copiedFingerprint.value = false }, 1500)
  } catch {
    // Clipboard unavailable in headless environments.
  }
}

const keyboardAnswers = ref<string[]>([])
watch(
  () => sessions.pendingKeyboardPrompt,
  (prompt) => {
    keyboardAnswers.value = prompt ? prompt.prompts.map(() => '') : []
  }
)

/** Template refs for each prompt's input, keyed by prompt index — lets Enter on a non-last
 * prompt (e.g. password before an OTP prompt) move focus forward instead of submitting early. */
const keyboardPromptInputs = ref<({ inputRef?: HTMLInputElement } | null)[]>([])

function onKeyboardPromptEnter(index: number): void {
  const promptCount = sessions.pendingKeyboardPrompt?.prompts.length ?? 0
  if (index >= promptCount - 1) {
    void submitKeyboardAnswers()
    return
  }
  keyboardPromptInputs.value[index + 1]?.inputRef?.focus()
}

async function submitKeyboardAnswers(): Promise<void> {
  await sessions.respondKeyboardInteractive([...keyboardAnswers.value])
}
</script>

<template>
  <UModal
    :open="Boolean(sessions.pendingHostKeyMismatch)"
    title="Host key changed"
    :ui="{ footer: 'flex-wrap justify-end' }"
    @update:open="(v: boolean) => { if (!v) sessions.dismissHostKeyMismatch(sessions.activeTabId) }"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <div v-if="sessions.pendingHostKeyMismatch?.label || sessions.pendingHostKeyMismatch?.hostLabel" class="text-xs text-muted">
          Target: <span class="font-medium text-highlighted">{{ sessions.pendingHostKeyMismatch?.label }}</span>
          <span v-if="sessions.pendingHostKeyMismatch?.hostLabel"> ({{ sessions.pendingHostKeyMismatch?.hostLabel }})</span>
        </div>
        <UAlert
          role="alert"
          color="warning"
          variant="soft"
          icon="i-lucide-shield-alert"
          title="This could mean a man-in-the-middle attack"
        />
        <p class="break-words [overflow-wrap:anywhere] text-sm text-default">{{ sessions.pendingHostKeyMismatch?.message }}</p>
        <p class="text-xs text-muted">
          Only continue if you're certain the change is legitimate, for example if the server was reinstalled or its key was
          deliberately rotated.
        </p>
      </div>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" @click="sessions.dismissHostKeyMismatch(sessions.activeTabId)">
        Cancel
      </UButton>
      <UButton
        color="warning"
        :loading="sessions.connecting"
        @click="sessions.acceptHostKeyAndRetry(sessions.activeTabId)"
      >
        Trust new key &amp; connect
      </UButton>
    </template>
  </UModal>

  <UModal
    :open="Boolean(sessions.pendingHostKeyPrompt)"
    title="Trust this server?"
    :ui="{ footer: 'flex-wrap justify-end' }"
    @update:open="(v: boolean) => { if (!v) sessions.respondHostKey(false) }"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
          <UBadge
            v-if="sessions.pendingHostKeyPrompt?.role === 'jump'"
            color="warning"
            variant="subtle"
            size="xs"
          >
            Jump host{{ typeof sessions.pendingHostKeyPrompt.hopIndex === 'number' ? ` #${sessions.pendingHostKeyPrompt.hopIndex + 1}` : '' }}
          </UBadge>
          <UBadge
            v-else-if="sessions.pendingHostKeyPrompt?.role === 'target'"
            color="primary"
            variant="subtle"
            size="xs"
          >
            Target host
          </UBadge>
          <UBadge
            v-if="sessions.pendingHostKeyPrompt?.algorithm"
            color="neutral"
            variant="outline"
            size="xs"
            class="font-mono"
          >
            {{ sessions.pendingHostKeyPrompt.algorithm }}
          </UBadge>
          <span v-if="sessions.pendingHostKeyPromptTab?.label">
            Tab: <span class="font-medium text-highlighted">{{ sessions.pendingHostKeyPromptTab.label }}</span>
          </span>
        </div>
        <p class="text-sm text-default">
          First connection to
          <span class="font-medium">{{ sessions.pendingHostKeyPrompt?.host }}:{{ sessions.pendingHostKeyPrompt?.port }}</span>.
          Check that this fingerprint matches the one your server administrator gave you.
        </p>
        <div class="flex items-start gap-2 rounded-md bg-muted p-2">
          <code class="min-w-0 flex-1 break-all font-mono text-xs text-highlighted">{{ sessions.pendingHostKeyPrompt?.fingerprint }}</code>
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            :icon="copiedFingerprint ? 'i-lucide-check' : 'i-lucide-copy'"
            :aria-label="copiedFingerprint ? 'Copied fingerprint' : 'Copy fingerprint'"
            @click="copyFingerprint"
          />
        </div>
      </div>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" autofocus @click="sessions.respondHostKey(false)">Cancel</UButton>
      <UButton color="primary" @click="sessions.respondHostKey(true)">Trust &amp; connect</UButton>
    </template>
  </UModal>

  <UModal
    :open="Boolean(sessions.pendingKeyboardPrompt)"
    title="Authentication required"
    :ui="{ footer: 'flex-wrap justify-end' }"
    @update:open="(v: boolean) => { if (!v) sessions.cancelKeyboardInteractive() }"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <div v-if="sessions.pendingKeyboardPromptTab?.label || sessions.pendingKeyboardPromptTab?.hostLabel" class="text-xs text-muted">
          Server:
          <span class="font-medium text-highlighted">
            {{ sessions.pendingKeyboardPromptTab?.label ?? sessions.pendingKeyboardPromptTab?.hostLabel }}
          </span>
          <span v-if="sessions.pendingKeyboardPromptTab?.label && sessions.pendingKeyboardPromptTab?.hostLabel">
            ({{ sessions.pendingKeyboardPromptTab.hostLabel }})
          </span>
        </div>
        <p v-if="sessions.pendingKeyboardPrompt?.instructions" class="text-sm text-default">
          {{ sessions.pendingKeyboardPrompt.instructions }}
        </p>
        <UFormField
          v-for="(prompt, i) in sessions.pendingKeyboardPrompt?.prompts ?? []"
          :key="i"
          :label="prompt.prompt"
        >
          <UInput
            v-if="prompt.echo"
            :ref="(el: any) => { keyboardPromptInputs[i] = el }"
            v-model="keyboardAnswers[i]"
            type="text"
            class="w-full"
            :autofocus="i === 0"
            @keyup.enter="onKeyboardPromptEnter(i)"
          />
          <PasswordInput
            v-else
            :ref="(el: any) => { keyboardPromptInputs[i] = el }"
            v-model="keyboardAnswers[i]"
            :label="prompt.prompt"
            class="w-full"
            :autofocus="i === 0"
            @keyup.enter="onKeyboardPromptEnter(i)"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" @click="sessions.cancelKeyboardInteractive">Cancel</UButton>
      <UButton @click="submitKeyboardAnswers">Submit</UButton>
    </template>
  </UModal>
</template>
