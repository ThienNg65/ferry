<script setup lang="ts">
import { reactive } from 'vue'
import type { QuickConnectInput } from '@shared/contract'
import { useSessionsStore } from '../../stores/sessions.store'

const sessions = useSessionsStore()

const form = reactive<QuickConnectInput>({
  name: 'Quick Connect',
  host: '',
  port: 22,
  username: '',
  authMethod: 'password',
  password: ''
})

async function onConnect(): Promise<void> {
  try {
    await sessions.connect({ ...form })
  } catch {
    // Surfaced via sessions.status/statusMessage in the template below.
  }
}
</script>

<template>
  <div class="flex h-full items-center justify-center bg-default">
    <UCard class="w-full max-w-sm">
      <template #header>
        <h1 class="text-base font-medium text-highlighted">Connect to a server</h1>
      </template>

      <div class="flex flex-col gap-3">
        <UFormField label="Host">
          <UInput v-model="form.host" placeholder="example.com" class="w-full" />
        </UFormField>
        <UFormField label="Port">
          <UInput v-model.number="form.port" type="number" class="w-full" />
        </UFormField>
        <UFormField label="Username">
          <UInput v-model="form.username" class="w-full" />
        </UFormField>
        <UFormField label="Password">
          <UInput v-model="form.password" type="password" class="w-full" />
        </UFormField>

        <UAlert
          v-if="sessions.status === 'error'"
          color="error"
          variant="soft"
          :title="sessions.statusMessage ?? 'Connection failed'"
        />
      </div>

      <template #footer>
        <UButton block :loading="sessions.connecting" @click="onConnect">Connect</UButton>
      </template>
    </UCard>
  </div>
</template>
