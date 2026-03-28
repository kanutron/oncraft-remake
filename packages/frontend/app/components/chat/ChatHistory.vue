<script setup lang="ts">
import type { ChatMessage } from '~/types'

const props = defineProps<{
  sessionId: string
}>()

const sessionStore = useSessionStore()

const messages = computed(() => sessionStore.messagesForSession(props.sessionId))

// Auto-scroll to bottom on new messages
const scrollContainer = ref<HTMLElement | null>(null)
const shouldAutoScroll = ref(true)

function onScroll() {
  if (!scrollContainer.value) return
  const { scrollTop, scrollHeight, clientHeight } = scrollContainer.value
  // Consider "at bottom" if within 80px of the bottom
  shouldAutoScroll.value = scrollHeight - scrollTop - clientHeight < 80
}

watch(
  () => messages.value.length,
  async () => {
    if (!shouldAutoScroll.value) return
    await nextTick()
    scrollContainer.value?.scrollTo({
      top: scrollContainer.value.scrollHeight,
      behavior: 'smooth',
    })
  },
)

onMounted(async () => {
  await nextTick()
  scrollContainer.value?.scrollTo({ top: scrollContainer.value.scrollHeight })
})

function resolveMessageType(message: ChatMessage): string {
  const raw = message.raw
  const data = (raw.data ?? raw) as Record<string, unknown>

  // Bridge-level event types (from the WebSocket wrapper)
  const event = raw.event as string | undefined
  if (event === 'session:tool-confirmation') return 'tool_confirmation'

  // SDK message types
  const type = (data.type ?? raw.type) as string | undefined
  if (type === 'tool_confirmation') return 'tool_confirmation'
  if (type === 'system') return 'system'
  if (type === 'bridge:error') return 'bridge:error'

  // Role-based dispatch
  const role = (data.role ?? raw.role) as string | undefined
  if (role === 'assistant') return 'assistant'
  if (role === 'user') return 'user'

  return 'generic'
}
</script>

<template>
  <div
    ref="scrollContainer"
    class="flex-1 overflow-y-auto"
    @scroll="onScroll"
  >
    <div class="max-w-4xl mx-auto py-4 flex flex-col gap-1">
      <template v-if="messages.length === 0">
        <div class="flex-1 flex items-center justify-center text-neutral-400 dark:text-neutral-500 min-h-[200px]">
          <p>No messages yet. Send a prompt to start the conversation.</p>
        </div>
      </template>

      <template v-for="message in messages" :key="message.id">
        <ChatAssistantMessage
          v-if="resolveMessageType(message) === 'assistant'"
          :message="message"
        />

        <ChatUserMessage
          v-else-if="resolveMessageType(message) === 'user'"
          :message="message"
        />

        <ChatToolApprovalBar
          v-else-if="resolveMessageType(message) === 'tool_confirmation'"
          :message="message"
          :session-id="sessionId"
        />

        <ChatSystemMessage
          v-else-if="resolveMessageType(message) === 'system'"
          :message="message"
        />

        <ChatErrorNotice
          v-else-if="resolveMessageType(message) === 'bridge:error'"
          :message="message"
        />

        <ChatGenericMessage
          v-else
          :message="message"
        />
      </template>
    </div>
  </div>
</template>
