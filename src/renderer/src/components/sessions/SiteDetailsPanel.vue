<script setup lang="ts">
import { computed } from 'vue'
import type { Site } from '@shared/contract'
import { ENVIRONMENT_DOT } from '../../utils/environment'

const props = defineProps<{
  site: Site
  icon: string
  /** Site already has a connected tab, so Connect switches to it. */
  connected: boolean
  /** This site's connection is opening (drives the spinner). */
  connecting: boolean
  /** Any connection is opening (disables Connect so a second request can't redirect it). */
  busy: boolean
}>()

const emit = defineEmits<{
  connect: []
  edit: []
  close: []
}>()

const AUTH_LABEL: Record<Site['authMethod'], string> = {
  password: 'Password',
  privateKey: 'Private key',
  agent: 'SSH agent'
}

const rows = computed(() => {
  const s = props.site
  const out: { label: string; value: string; mono?: boolean }[] = [
    { label: 'Auth', value: AUTH_LABEL[s.authMethod] }
  ]
  if (s.group) out.push({ label: 'Group', value: s.group })
  if (s.environment) out.push({ label: 'Environment', value: s.environment })
  if (s.remoteInitialPath) out.push({ label: 'Remote path', value: s.remoteInitialPath, mono: true })
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
          <h2 class="flex min-w-0 items-center gap-1.5 text-base font-medium text-highlighted">
            <span v-if="site.environment" class="size-2 shrink-0 rounded-full" :class="ENVIRONMENT_DOT[site.environment]" />
            <span class="truncate">{{ site.name }}</span>
          </h2>
          <p class="truncate font-mono text-xs text-muted">{{ site.username }}@{{ site.host }}:{{ site.port }}</p>
        </div>
        <UTooltip text="Back to Quick Connect">
          <UButton
            icon="i-lucide-x"
            size="xs"
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
        <dd class="min-w-0 break-words text-default" :class="row.mono ? 'font-mono text-xs leading-5' : ''">{{ row.value }}</dd>
      </template>
    </dl>

    <template #footer>
      <div class="flex gap-2">
        <UButton
          icon="i-lucide-play"
          class="flex-1 justify-center"
          :loading="connecting"
          :disabled="busy"
          @click="emit('connect')"
        >
          {{ connected ? 'Switch to tab' : 'Connect' }}
        </UButton>
        <UButton color="neutral" variant="outline" icon="i-lucide-pencil" @click="emit('edit')">Edit</UButton>
      </div>
      <p class="mt-2 text-2xs text-muted">Tip: double-click a site in the list to connect.</p>
    </template>
  </UCard>
</template>
