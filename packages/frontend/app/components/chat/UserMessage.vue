<script setup lang="ts">
import type { ChatMessage } from '~/types'

const props = defineProps<{
  message: ChatMessage
}>()

const text = computed(() => {
  const raw = props.message.raw
  const data = (raw.data ?? raw) as Record<string, unknown>

  // SDK user messages: data.content can be a string or array of content blocks
  const content = data.content ?? data.message ?? data.text ?? ''
  if (typeof content === 'string') return content

  // Array of content blocks — extract text parts
  if (Array.isArray(content)) {
    return content
      .filter((b: Record<string, unknown>) => b.type === 'text')
      .map((b: Record<string, unknown>) => b.text as string)
      .join('\n')
  }

  return JSON.stringify(content)
})
</script>

<template>
  <UChatMessage
    :id="message.id"
    role="user"
    side="right"
    variant="soft"
    icon="i-lucide-user"
    :parts="[]"
  >
    <template #content>
      <p class="whitespace-pre-wrap">{{ text }}</p>
    </template>
  </UChatMessage>
</template>
