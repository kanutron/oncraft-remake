import { computed } from 'vue'
import type { Ref } from 'vue'
import type { ChatMessage } from '~/types'
import type { ChatStreamComponent, ChatSideChannelEvent, ChatEventKind } from '~/types/chat'
import { classifyEvent } from './classify-event'

interface Block { type: string; id?: string; name?: string; thinking?: string; text?: string; [k: string]: unknown }

const BLOCK_KIND_MAP: Record<string, { kind: ChatEventKind; defaultMode: 'badge' | 'compact' | 'full' }> = {
  text: { kind: 'block-text', defaultMode: 'full' },
  thinking: { kind: 'block-thinking', defaultMode: 'compact' },
  tool_use: { kind: 'block-tool-use', defaultMode: 'badge' },
  image: { kind: 'block-image', defaultMode: 'compact' },
  redacted_thinking: { kind: 'block-redacted-thinking', defaultMode: 'badge' },
}

function fanOutAssistant(msg: ChatMessage, raw: any): ChatStreamComponent[] {
  const messageId = raw?.message?.id ?? msg.id
  const blocks: Block[] = raw?.message?.content ?? []
  return blocks.map((block, i) => {
    const mapping = BLOCK_KIND_MAP[block.type]
    if (!mapping) {
      return {
        componentKey: `${messageId}:${i}`,
        kind: 'generic-system',
        data: block,
        defaultMode: 'badge',
      }
    }
    const componentKey = block.id ?? `${messageId}:${i}`
    return {
      componentKey,
      kind: mapping.kind,
      data: block,
      defaultMode: mapping.defaultMode,
    }
  })
}

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

    if (relationship === 'fan-out') {
      out.push(...fanOutAssistant(msg, raw))
      continue
    }

    // 'mutate' / 'replace' — handled in later tasks.
  }

  return { components: out, sideChannel: side }
}
