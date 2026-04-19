<script setup lang="ts">
import type { ChatMessage } from '~/types'
import { resolveChatComponent } from '~/composables/chat/resolve-component'

const props = defineProps<{
  agentId: string
  agentType?: string
  description?: string
  messages: Record<string, unknown>[]
  sessionId: string
}>()

const wrapped = computed<ChatMessage[]>(() =>
  props.messages.map((raw, i) => ({
    id: `${props.agentId}:${i}`,
    sessionId: props.sessionId,
    timestamp: new Date().toISOString(),
    raw: raw as ChatMessage['raw'],
  })),
)

const { components } = useChatReducer(wrapped)
</script>

<template>
  <div class="border-l-2 border-primary/30 pl-3 ml-1 space-y-1">
    <div class="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
      <UIcon name="i-lucide-bot" class="size-3" />
      <span class="font-mono">{{ agentType ?? 'subagent' }}</span>
      <span v-if="description" class="truncate">· {{ description }}</span>
    </div>
    <template v-for="item in components" :key="item.componentKey">
      <component
        :is="resolveChatComponent(item.kind)"
        v-if="resolveChatComponent(item.kind)"
        :component-key="`${agentId}:${item.componentKey}`"
        :default-mode="item.defaultMode"
        :data="item.data"
        :status="item.status"
        :session-id="sessionId"
      />
    </template>
  </div>
</template>
