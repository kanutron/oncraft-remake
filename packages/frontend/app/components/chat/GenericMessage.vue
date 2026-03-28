<script setup lang="ts">
import type { ChatMessage } from '~/types'

defineProps<{
  message: ChatMessage
}>()
</script>

<template>
  <div class="px-4 py-2">
    <div class="text-xs text-neutral-400 dark:text-neutral-500 mb-1">
      Unknown message type
    </div>
    <pre class="text-xs font-mono bg-neutral-100 dark:bg-neutral-900 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">{{ JSON.stringify(message.raw, null, 2) }}</pre>
  </div>
</template>
