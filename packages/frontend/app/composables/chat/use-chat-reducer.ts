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

const ASSISTANT_CHAIN_KINDS: ReadonlySet<ChatEventKind> = new Set<ChatEventKind>([
  'assistant-header',
  'block-text',
  'block-thinking',
  'block-tool-use',
  'block-image',
  'block-redacted-thinking',
])

function fanOutAssistant(
  msg: ChatMessage,
  raw: any,
  opts: { isContinuation?: boolean } = {},
): ChatStreamComponent[] {
  const messageId = raw?.message?.id ?? msg.id
  const blocks: Block[] = raw?.message?.content ?? []
  const header: ChatStreamComponent = {
    componentKey: `${messageId}:header`,
    kind: 'assistant-header' as const,
    data: { messageId, model: raw?.message?.model, usage: raw?.message?.usage },
    defaultMode: 'compact' as const,
  }
  const blockComps = blocks.map((block, i) => {
    const mapping = BLOCK_KIND_MAP[block.type]
    const dataWithParent = { ...block, _parentMessageId: messageId }
    const componentKey = block.id ?? `${messageId}:${i}`
    if (!mapping) {
      return { componentKey, kind: 'generic-system' as const, data: dataWithParent, defaultMode: 'badge' as const }
    }
    return { componentKey, kind: mapping.kind, data: dataWithParent, defaultMode: mapping.defaultMode }
  })
  // One header per assistant "run": emit on the first turn of a run (not a
  // continuation of a previous assistant chain), skip on every subsequent
  // turn in that run. Keeps consecutive tool-only badges flowing inline while
  // still introducing the run the first time it starts.
  return opts.isContinuation ? blockComps : [header, ...blockComps]
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
    if (raw?.parent_tool_use_id) continue // subagent turn; rendered nested, not at top level

    if (relationship === 'side-channel') { side.push({ kind, data: raw }); continue }

    if (relationship === 'spawn') {
      const needsCorr = kind === 'hook-entry' || kind === 'task-entry'
      const corr = descriptor.correlationKey?.(raw)
      const componentKey = needsCorr && corr ? corr : msg.id
      out.push({ componentKey, kind, data: raw, defaultMode: descriptor.defaultMode })
      continue
    }

    if (relationship === 'fan-out') {
      const prev = out[out.length - 1]
      const isContinuation = !!prev && ASSISTANT_CHAIN_KINDS.has(prev.kind)
      const fanned = fanOutAssistant(msg, raw, { isContinuation })
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

  // Pass 4: sticky eligibility. Tool confirmations stay sticky inline (they need
  // persistent visibility for user approval). User messages are NOT marked sticky
  // here — ChatHistory mounts an IntersectionObserver and renders a floating copy
  // only when the inline user message leaves the viewport.
  for (const c of out) if (c.kind === 'tool-confirmation') c.sticky = true

  // Pass 5: mutate by correlation key (hooks, tasks).
  const byKey = new Map<string, ChatStreamComponent>()
  for (const c of out) if (c.kind === 'hook-entry' || c.kind === 'task-entry') byKey.set(c.componentKey, c)

  for (const msg of messages) {
    const raw = (msg.raw?.data ?? msg.raw) as any
    const { relationship, descriptor, kind: evtKind, correlationKey } = classifyEvent(raw)
    if (relationship !== 'mutate' || !descriptor) continue
    if (evtKind !== 'hook-entry' && evtKind !== 'task-entry') continue

    const key = correlationKey
    if (!key) continue
    const parent = byKey.get(key)
    if (!parent) continue

    parent.data = { ...(parent.data as object), ...raw }
    if (descriptor.subtype === 'hook_response') {
      parent.status = raw.decision === 'deny' ? 'error' : 'success'
    }
    else if (descriptor.subtype === 'hook_progress' || descriptor.type === 'task_progress') {
      parent.status ??= 'running'
    }
  }

  return { components: out, sideChannel: side }
}
