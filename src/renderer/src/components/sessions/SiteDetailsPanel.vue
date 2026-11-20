<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import type { Site } from '@shared/contract'
import { ENVIRONMENT_DOT, ENVIRONMENT_LABEL } from '../../utils/environment'

const props = defineProps<{
  site: Site
  icon: string
  /** Site already has a connected tab, so Connect switches to it. */
  connected: boolean
  /** This site's connection is opening (drives the spinner). */
  connecting: boolean
  /** Any connection is opening (disables Connect so a second request can't redirect it). */
  busy: boolean
  duplicating?: boolean
}>()

const emit = defineEmits<{
  connect: []
  disconnect: []
  edit: []
  duplicate: []
  delete: []
  close: []
}>()

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

onUnmounted(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})

async function copyAddress(): Promise<void> {
  try {
    await navigator.clipboard.writeText(`${props.site.username}@${props.site.host}`)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    // Clipboard access unavailable in headless/test environments.
  }
}

const AUTH_LABEL: Record<Site['authMethod'], string> = {
  password: 'Password',
  privateKey: 'Private key',
  agent: 'SSH agent'
}

const rows = computed(() => {
  const s = props.site
  const out: { label: string; value: string; mono?: boolean; warn?: boolean }[] = [
    { label: 'Auth', value: AUTH_LABEL[s.authMethod] }
  ]
  if (s.authMethod === 'password') {
    out.push({
      label: 'Password',
      value: s.hasPassword ? 'Saved (encrypted)' : 'Not set — edit or enter on connect',
      warn: !s.hasPassword
    })
  } else if (s.authMethod === 'privateKey') {
    out.push({
      label: 'Key file',
      value: s.privateKeyPath || 'Not set',
      mono: Boolean(s.privateKeyPath),
      warn: !s.privateKeyPath
    })
    out.push({
      label: 'Passphrase',
      value: s.hasPassphrase ? 'Saved (encrypted)' : 'None'
    })
  } else {
    out.push({
      label: 'Agent',
      value: s.agentPath || 'System default',
      mono: Boolean(s.agentPath)
    })
  }
  if (s.group) out.push({ label: 'Group', value: s.group })
  if (s.environment) out.push({ label: 'Environment', value: ENVIRONMENT_LABEL[s.environment] })
  if (s.remoteInitialPath) out.push({ label: 'Remote path', value: s.remoteInitialPath, mono: true })
  if (s.localInitialPath) out.push({ label: 'Local path', value: s.localInitialPath, mono: true })
  if (s.jumpHosts?.length) {
    out.push({ label: 'Jump hosts', value: s.jumpHosts.map((h) => `${h.username}@${h.host}:${h.port}`).join(' → '), mono: true })
  }
  if (s.proxyMode === 'custom' && s.proxy) {
    out.push({ label: 'Proxy', value: `${s.proxy.type} ${s.proxy.host}:${s.proxy.port}`, mono: true })
  }
  return out
})
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-start gap-3">
        <div class="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted">
          <UIcon :name="icon" class="size-4" />
        </div>
        <div class="min-w-0 flex-1">
          <h2 id="connect-panel-heading" class="flex min-w-0 items-center gap-1.5 text-base font-medium text-highlighted">
            <span
              v-if="site.environment"
              class="size-2 shrink-0 rounded-full"
              :class="ENVIRONMENT_DOT[site.environment]"
              :title="ENVIRONMENT_LABEL[site.environment]"
            />
            <span v-if="site.environment" class="sr-only">({{ ENVIRONMENT_LABEL[site.environment] }})</span>
            <span class="truncate">{{ site.name }}</span>
          </h2>
          <div class="flex items-center gap-1">
            <p class="truncate font-mono text-xs text-muted">{{ site.username }}@{{ site.host }}:{{ site.port }}</p>
            <UTooltip :text="copied ? 'Copied!' : 'Copy user@host'">
              <UButton
                :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                size="xs"
                color="neutral"
                variant="ghost"
                :aria-label="copied ? 'Copied user@host' : 'Copy user@host'"
                @click="copyAddress"
              />
            </UTooltip>
          </div>
        </div>
        <UTooltip text="Back to Quick Connect (Esc)">
          <UButton
            icon="i-lucide-x"
            size="sm"
            color="neutral"
            variant="ghost"
            aria-label="Back to Quick Connect"
            @click="emit('close')"
          />
        </UTooltip>
      </div>
    </template>

    <dl class="grid grid-cols-[6.5rem_1fr] gap-x-4 gap-y-2.5 text-sm">
      <template v-for="row in rows" :key="row.label">
        <dt class="text-muted">{{ row.label }}</dt>
        <dd
          class="min-w-0 break-words"
          :class="[row.warn ? 'text-warning' : 'text-default', row.mono ? 'font-mono text-xs leading-5' : '']"
        >
          {{ row.value }}
        </dd>
      </template>
    </dl>

    <template #footer>
      <div class="flex flex-wrap items-center gap-2 [flex-wrap:balance]">
        <UButton
          icon="i-lucide-play"
          class="min-w-fit flex-1 justify-center whitespace-nowrap"
          :loading="connecting"
          :disabled="busy"
          @click="emit('connect')"
        >
          {{ connected ? 'Switch to tab' : 'Connect' }}
        </UButton>
        <UButton
          v-if="connected"
          color="neutral"
          variant="outline"
          icon="i-lucide-unplug"
          class="shrink-0 whitespace-nowrap"
          @click="emit('disconnect')"
        >
          Disconnect
        </UButton>
        <div class="ml-auto flex shrink-0 items-center gap-1.5">
          <UButton color="neutral" variant="outline" icon="i-lucide-pencil" class="whitespace-nowrap" @click="emit('edit')">
            Edit
          </UButton>
          <UTooltip text="Duplicate site">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-copy"
              aria-label="Duplicate site"
              :loading="duplicating"
              @click="emit('duplicate')"
            />
          </UTooltip>
          <UTooltip text="Delete site">
            <UButton
              color="error"
              variant="ghost"
              size="sm"
              icon="i-lucide-trash-2"
              aria-label="Delete site"
              @click="emit('delete')"
            />
          </UTooltip>
        </div>
      </div>
      <p class="mt-2 text-xs text-muted">Tip: double-click or press Enter on a site to connect.</p>
    </template>
  </UCard>
</template>
