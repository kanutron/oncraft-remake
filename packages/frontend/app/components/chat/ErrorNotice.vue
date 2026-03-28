<script setup lang="ts">
import type { ChatMessage } from '~/types'

defineProps<{
  message: ChatMessage
}>()
</script>

<template>
  <div class="px-4 py-2">
    <UAlert
      color="error"
      variant="subtle"
      icon="i-lucide-alert-triangle"
      :title="(message.raw.data as Record<string, unknown>)?.message as string ?? 'Error'"
      :description="(message.raw.data as Record<string, unknown>)?.details as string ?? JSON.stringify(message.raw)"
    />
  </div>
</template>
