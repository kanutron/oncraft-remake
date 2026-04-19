import { computed } from 'vue'
import type { Ref } from 'vue'
import type { ChatMessage } from '~/types'
import type { ChatStreamComponent, ChatSideChannelEvent } from '~/types/chat'
import { classifyEvent } from './classify-event'

export function useChatReducer(source: Ref<ChatMessage[]>) {
  const components = computed<ChatStreamComponent[]>(() => derive(source.value).components)
  const sideChannel = computed<ChatSideChannelEvent[]>(() => derive(source.value).sideChannel)

  return { components, sideChannel }
}

interface Derived {
  components: ChatStreamComponent[]
  sideChannel: ChatSideChannelEvent[]
}

function derive(messages: ChatMessage[]): Derived {
  const out: ChatStreamComponent[] = []
  const side: ChatSideChannelEvent[] = []

  for (const msg of messages) {
    const raw = (msg.raw?.data ?? msg.raw) as unknown
    const { relationship, descriptor, kind } = classifyEvent(raw)

    if (relationship === 'discard' || !descriptor) continue

    if (relationship === 'side-channel') {
      side.push({ kind, data: raw })
      continue
    }

    if (relationship === 'spawn') {
      out.push({
        componentKey: msg.id,
        kind,
        data: raw,
        defaultMode: descriptor.defaultMode,
      })
      continue
    }

    // 'mutate' / 'fan-out' / 'replace' — handled in later tasks.
  }

  return { components: out, sideChannel: side }
}
