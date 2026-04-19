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
    const dataWithParent = { ...block, _parentMessageId: messageId }
    const componentKey = block.id ?? `${messageId}:${i}`
    if (!mapping) {
      return { componentKey, kind: 'generic-system' as const, data: dataWithParent, defaultMode: 'badge' as const }
    }
    return { componentKey, kind: mapping.kind, data: dataWithParent, defaultMode: mapping.defaultMode }
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
  // Pass 1: walk events, track tool_results to fold in.
  const toolResults = new Map<string, { content: unknown; is_error: boolean }>()
  const userMessagesWithOnlyToolResults = new Set<string>()

  for (const msg of messages) {
    const raw = (msg.raw?.data ?? msg.raw) as any
    if (raw?.type === 'user') {
      const content = raw?.message?.content
      if (Array.isArray(content) && content.every((b: any) => b?.type === 'tool_result')) {
        for (const b of content) {
          toolResults.set(b.tool_use_id, { content: b.content, is_error: !!b.is_error })
        }
        userMessagesWithOnlyToolResults.add(msg.id)
      }
    }
  }

  // Pass 2: build components.
  for (const msg of messages) {
    const raw = (msg.raw?.data ?? msg.raw) as any
    const { relationship, descriptor, kind } = classifyEvent(raw)

    if (relationship === 'discard' || !descriptor) continue
    if (userMessagesWithOnlyToolResults.has(msg.id)) continue // folded into tool_use components

    if (relationship === 'side-channel') { side.push({ kind, data: raw }); continue }

    if (relationship === 'spawn') {
      out.push({ componentKey: msg.id, kind, data: raw, defaultMode: descriptor.defaultMode })
      continue
    }

    if (relationship === 'fan-out') {
      const fanned = fanOutAssistant(msg, raw)
      for (const c of fanned) {
        if (c.kind === 'block-tool-use') {
          const block = c.data as any
          const result = toolResults.get(block.id)
          if (result) {
            c.data = { ...block, tool_result: result }
            c.status = result.is_error ? 'error' : 'success'
            if (result.is_error) c.defaultMode = 'compact'
          } else {
            c.status = 'running'
          }
        }
        out.push(c)
      }
      continue
    }
  }

  // Pass 3: streaming mutate — any stream_event with matching message.id marks the assistant stream as streaming.
  const streamingMessageIds = new Set<string>()
  for (const msg of messages) {
    const raw = (msg.raw?.data ?? msg.raw) as any
    if (raw?.type === 'stream_event') {
      const id = raw?.message?.id
      if (typeof id === 'string') streamingMessageIds.add(id)
    }
  }
  // Also: if a result event appears, streaming is finalized.
  const finalized = new Set<string>()
  for (const msg of messages) {
    const raw = (msg.raw?.data ?? msg.raw) as any
    if (raw?.type === 'result') finalized.add('*')
  }
  for (const c of out) {
    const messageId = (c.data as any)?._parentMessageId ?? (c.data as any)?.message?.id
    if (messageId && streamingMessageIds.has(messageId) && !finalized.has('*')) {
      if (c.kind === 'block-text' || c.kind === 'block-tool-use' || c.kind === 'block-thinking') {
        c.status = c.status ?? 'streaming'
      }
    }
  }

  // Pass 4: sticky eligibility.
  let lastUserIdx = -1
  for (let i = 0; i < out.length; i++) if (out[i].kind === 'user') lastUserIdx = i
  if (lastUserIdx !== -1 && lastUserIdx < out.length - 1) out[lastUserIdx].sticky = true
  for (const c of out) if (c.kind === 'tool-confirmation') c.sticky = true

  return { components: out, sideChannel: side }
}
