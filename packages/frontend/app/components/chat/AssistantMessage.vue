<script setup lang="ts">
import type { ChatMessage } from '~/types'

const props = defineProps<{
  message: ChatMessage
}>()

const data = computed(() => (props.message.raw.data ?? props.message.raw) as Record<string, unknown>)

const contentBlocks = computed(() => {
  // SDK wraps content inside message.content
  const sdkMessage = data.value.message as Record<string, unknown> | undefined
  const content = sdkMessage?.content ?? data.value.content

  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }
  if (Array.isArray(content)) {
    return content as Record<string, unknown>[]
  }
  // Fallback: treat as a single text block
  const text = (data.value.text ?? (typeof sdkMessage === 'string' ? sdkMessage : undefined)) as string | undefined
  if (text) {
    return [{ type: 'text', text }]
  }
  return []
})
</script>

<template>
  <UChatMessage
    :id="message.id"
    role="assistant"
    side="left"
    variant="naked"
    :avatar="{ icon: 'i-lucide-bot' }"
    :parts="[]"
  >
    <template #content>
      <template v-for="(block, index) in contentBlocks" :key="`${message.id}-${index}`">
        <div v-if="block.type === 'text' && (block.text as string)" class="whitespace-pre-wrap *:first:mt-0 *:last:mb-0">
          {{ block.text }}
        </div>

        <ChatToolInvocation
          v-else-if="block.type === 'tool_use'"
          :tool-use="block"
        />

        <ChatThinkingBlock
          v-else-if="block.type === 'thinking'"
          :content="(block.thinking ?? block.text ?? '') as string"
        />
      </template>
    </template>
  </UChatMessage>
</template>
