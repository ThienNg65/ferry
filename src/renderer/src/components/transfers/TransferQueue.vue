<script setup lang="ts">
import { onMounted } from 'vue'
import { useTransferQueueStore } from '../../stores/transferQueue.store'
import TransferItem from './TransferItem.vue'

const store = useTransferQueueStore()

onMounted(() => {
  store.ensureSubscription()
})
</script>

<template>
  <div class="flex h-full flex-col overflow-y-auto">
    <TransferItem
      v-for="item in store.list"
      :key="item.transferId"
      :kind="item.kind"
      :state="item.state"
      :local-path="item.localPath"
      :remote-path="item.remotePath"
      :bytes-transferred="item.bytesTransferred"
      :total-bytes="item.totalBytes"
      :eta-ms="item.etaMs"
      :error="item.error"
      @cancel="store.cancel(item.transferId)"
      @retry="store.retry(item.transferId)"
    />
    <p v-if="store.list.length === 0" class="px-3 py-6 text-center text-xs text-muted">No transfers yet</p>
  </div>
</template>
