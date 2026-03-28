<script setup lang="ts">
import type { ChatMessage } from '~/types'

const props = defineProps<{
  message: ChatMessage
}>()

const text = computed(() => {
  const d = (props.message.raw.data ?? props.message.raw) as Record<string, unknown>
  return (d.message ?? d.text ?? d.content ?? JSON.stringify(d)) as string
})
</script>

<template>
  <div class="px-4 py-2">
    <UAlert
      color="info"
      variant="subtle"
      icon="i-lucide-info"
      :title="text"
    />
  </div>
</template>
