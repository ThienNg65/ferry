<script setup lang="ts">
import { computed } from 'vue'
import type { Site } from '@shared/contract'
import { ENVIRONMENT_DOT } from '../../utils/environment'

const props = defineProps<{
  site: Site
  /** Site already has a connected tab — Connect switches to it. */
  connected: boolean
  /** Some connection is currently opening (this site's or another's). */
  connecting: boolean
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
    { label: 'Host', value: `${s.username}@${s.host}:${s.port}`, mono: true },
    { label: 'Auth', value: AUTH_LABEL[s.authMethod] }
  ]
  if (s.group) out.push({ label: 'Group', value: s.group })
  if (s.environment) out.push({ label: 'Environment', value: s.environment })
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
      <div class="flex items-center justify-between gap-2">
        <h2 class="flex min-w-0 items-center gap-1.5 text-base font-medium text-highlighted">
          <span v-if="site.environment" class="size-2 shrink-0 rounded-full" :class="ENVIRONMENT_DOT[site.environment]" />
          <span class="truncate">{{ site.name }}</span>
        </h2>
        <UButton label="Quick Connect" size="xs" color="neutral" variant="ghost" @click="emit('close')" />
      </div>
    </template>

    <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      <template v-for="row in rows" :key="row.label">
        <dt class="text-muted">{{ row.label }}</dt>
        <dd class="min-w-0 break-words text-default" :class="row.mono ? 'font-mono text-xs' : ''">{{ row.value }}</dd>
      </template>
    </dl>

    <template #footer>
      <div class="flex gap-2">
        <UButton
          icon="i-lucide-play"
          class="flex-1 justify-center"
          :loading="connecting"
          :disabled="connecting"
          @click="emit('connect')"
        >
          {{ connected ? 'Switch to tab' : 'Connect' }}
        </UButton>
        <UButton color="neutral" variant="outline" icon="i-lucide-pencil" @click="emit('edit')">Edit</UButton>
      </div>
    </template>
  </UCard>
</template>
