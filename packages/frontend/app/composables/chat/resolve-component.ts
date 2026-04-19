import type { ChatEventKind } from '~/types/chat'
import type { Component } from 'vue'

import ChatAssistantHeader from '~/components/chat/ChatAssistantHeader.vue'
import ChatBlockText from '~/components/chat/ChatBlockText.vue'
import ChatBlockThinking from '~/components/chat/ChatBlockThinking.vue'
import ChatBlockToolUse from '~/components/chat/ChatBlockToolUse.vue'
import ChatUserMessage from '~/components/chat/ChatUserMessage.vue'
import ChatSystemInit from '~/components/chat/ChatSystemInit.vue'
import ChatResult from '~/components/chat/ChatResult.vue'
import ChatCompactBoundary from '~/components/chat/ChatCompactBoundary.vue'
import ChatToolConfirmation from '~/components/chat/ChatToolConfirmation.vue'
import ChatBridgeError from '~/components/chat/ChatBridgeError.vue'
import ChatAPIRetry from '~/components/chat/ChatAPIRetry.vue'
import ChatLocalCommandOutput from '~/components/chat/ChatLocalCommandOutput.vue'
import ChatNotification from '~/components/chat/ChatNotification.vue'
import ChatToolUseSummary from '~/components/chat/ChatToolUseSummary.vue'
import ChatHookEntry from '~/components/chat/ChatHookEntry.vue'

const MAP: Partial<Record<ChatEventKind, Component>> = {
  'assistant-header': ChatAssistantHeader,
  'block-text': ChatBlockText,
  'block-thinking': ChatBlockThinking,
  'block-tool-use': ChatBlockToolUse,
  'user': ChatUserMessage,
  'system-init': ChatSystemInit,
  'result': ChatResult,
  'compact-boundary': ChatCompactBoundary,
  'tool-confirmation': ChatToolConfirmation,
  'bridge-error': ChatBridgeError,
  'api-retry': ChatAPIRetry,
  'local-command-output': ChatLocalCommandOutput,
  'notification': ChatNotification,
  'tool-use-summary': ChatToolUseSummary,
  'hook-entry': ChatHookEntry,
}

export function resolveChatComponent(kind: ChatEventKind): Component | null {
  return MAP[kind] ?? null
}
