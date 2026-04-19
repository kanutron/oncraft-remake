import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useChatReducer } from '~/composables/chat/use-chat-reducer'

function makeMessage(raw: unknown) {
  return { id: crypto.randomUUID(), sessionId: 's1', timestamp: new Date().toISOString(), raw: raw as any }
}

describe('useChatReducer — spawn / discard / side-channel', () => {
  it('produces a single spawn component for a user message', () => {
    const src = ref([makeMessage({ type: 'user', content: 'hello' })])
    const { components, sideChannel } = useChatReducer(src)
    expect(components.value).toHaveLength(1)
    expect(components.value[0]).toMatchObject({ kind: 'user', defaultMode: 'full' })
    expect(sideChannel.value).toHaveLength(0)
  })

  it('discards bridge:ready events', () => {
    const src = ref([makeMessage({ type: 'bridge:ready' })])
    const { components } = useChatReducer(src)
    expect(components.value).toHaveLength(0)
  })

  it('routes status events to the side-channel emitter, not the stream', () => {
    const src = ref([
      makeMessage({ type: 'system', subtype: 'status', status: 'requesting' }),
    ])
    const { components, sideChannel } = useChatReducer(src)
    expect(components.value).toHaveLength(0)
    expect(sideChannel.value).toHaveLength(1)
    expect(sideChannel.value[0].kind).toBe('generic-system')
  })

  it('preserves event order for multiple spawns', () => {
    const src = ref([
      makeMessage({ type: 'user', content: 'a' }),
      makeMessage({ type: 'system', subtype: 'init', model: 'x' }),
    ])
    const { components } = useChatReducer(src)
    expect(components.value.map(c => c.kind)).toEqual(['user', 'system-init'])
  })

  it('spawns a user-replay component for hydrated user messages', () => {
    const src = ref([
      makeMessage({ type: 'user_replay', message: { role: 'user', content: 'say hi' } }),
    ])
    const { components } = useChatReducer(src)
    expect(components.value).toHaveLength(1)
    expect(components.value[0]).toMatchObject({ kind: 'user-replay', defaultMode: 'full' })
  })
})

describe('useChatReducer — fan-out', () => {
  it('fans out an assistant message with text + tool_use blocks into 2 components', () => {
    const src = ref([makeMessage({
      type: 'assistant',
      message: {
        id: 'msg_1',
        content: [
          { type: 'text', text: 'ok' },
          { type: 'tool_use', id: 'tool_a', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    })])
    const { components } = useChatReducer(src)
    expect(components.value).toHaveLength(3)
    expect(components.value[0].kind).toBe('assistant-header')
    expect(components.value[1].kind).toBe('block-text')
    expect(components.value[2].kind).toBe('block-tool-use')
    expect(components.value[2].componentKey).toBe('tool_a') // tool_use_id for correlation
  })

  it('falls back to index-based key for blocks with no id', () => {
    const src = ref([makeMessage({
      type: 'assistant',
      message: { id: 'msg_2', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
    })])
    const { components } = useChatReducer(src)
    expect(components.value.map(c => c.componentKey)).toEqual(['msg_2:header', 'msg_2:0', 'msg_2:1'])
  })

  it('assigns defaults: text=full, thinking=compact, tool_use=badge', () => {
    const src = ref([makeMessage({
      type: 'assistant',
      message: {
        id: 'msg_3',
        content: [
          { type: 'text', text: 't' },
          { type: 'thinking', thinking: 'hmm' },
          { type: 'tool_use', id: 'x', name: 'Read', input: {} },
        ],
      },
    })])
    const { components } = useChatReducer(src)
    expect(components.value.map(c => c.defaultMode)).toEqual(['compact', 'full', 'compact', 'badge'])
  })

  it('emits an assistant-header before each assistant fan-out', () => {
    const src = ref([makeMessage({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'hi' }] } })])
    const { components } = useChatReducer(src)
    expect(components.value.map(c => c.kind)).toEqual(['assistant-header', 'block-text'])
    expect(components.value[0].componentKey).toBe('m1:header')
    expect(components.value[0].defaultMode).toBe('compact')
  })

  it('emits a header for the first tool-only turn of a run (not a continuation)', () => {
    const src = ref([
      makeMessage({ type: 'user', message: { content: 'go' } }),
      makeMessage({
        type: 'assistant',
        message: { id: 'm_tool_only', content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }] },
      }),
    ])
    const { components } = useChatReducer(src)
    expect(components.value.map(c => c.kind)).toEqual(['user', 'assistant-header', 'block-tool-use'])
  })

  it('skips the header for tool-only continuations of an assistant chain', () => {
    const src = ref([
      makeMessage({ type: 'user', message: { content: 'go' } }),
      makeMessage({
        type: 'assistant',
        message: { id: 'm_a', content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }] },
      }),
      makeMessage({
        type: 'assistant',
        message: { id: 'm_b', content: [{ type: 'tool_use', id: 'tu_2', name: 'Bash', input: {} }] },
      }),
    ])
    const { components } = useChatReducer(src)
    expect(components.value.map(c => c.kind)).toEqual([
      'user', 'assistant-header', 'block-tool-use', 'block-tool-use',
    ])
  })

  it('skips the header for tool-only continuation that starts with signed-empty thinking', () => {
    const src = ref([
      makeMessage({ type: 'user', message: { content: 'go' } }),
      makeMessage({
        type: 'assistant',
        message: { id: 'm_a', content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: {} }] },
      }),
      makeMessage({
        type: 'assistant',
        message: {
          id: 'm_signed',
          content: [
            { type: 'thinking', thinking: '', signature: 'sig-abc' },
            { type: 'tool_use', id: 'tu_2', name: 'Bash', input: {} },
          ],
        },
      }),
    ])
    const { components } = useChatReducer(src)
    expect(components.value.map(c => c.kind)).toEqual([
      'user', 'assistant-header', 'block-tool-use', 'block-thinking', 'block-tool-use',
    ])
  })
})

describe('useChatReducer — tool_use ↔ tool_result pairing', () => {
  it('attaches a tool_result to its paired tool_use by tool_use_id', () => {
    const src = ref([
      makeMessage({
        type: 'assistant',
        message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { cmd: 'ls' } }] },
      }),
      makeMessage({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'output', is_error: false }] },
      }),
    ])
    const { components } = useChatReducer(src)
    // First assistant turn of a run emits a header; tool_result-only user message is folded
    expect(components.value).toHaveLength(2)
    const tool = components.value[1]
    expect(tool.kind).toBe('block-tool-use')
    expect((tool.data as any).tool_result).toMatchObject({ content: 'output', is_error: false })
    expect(tool.status).toBe('success')
  })

  it('sets status=error when the paired tool_result is is_error', () => {
    const src = ref([
      makeMessage({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: {} }] } }),
      makeMessage({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'boom', is_error: true }] } }),
    ])
    const { components } = useChatReducer(src)
    expect(components.value[1].status).toBe('error')
  })

  it('flips defaultMode from badge to compact for failed tools', () => {
    const src = ref([
      makeMessage({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't3', name: 'Edit', input: {} }] } }),
      makeMessage({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't3', content: 'x', is_error: true }] } }),
    ])
    const { components } = useChatReducer(src)
    expect(components.value[1].defaultMode).toBe('compact')
  })

  it('tool_use without result shows status=running', () => {
    const src = ref([
      makeMessage({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't4', name: 'Read', input: {} }] } }),
    ])
    const { components } = useChatReducer(src)
    expect(components.value[1].status).toBe('running')
  })
})

describe('useChatReducer — streaming and sticky', () => {
  it('sets status=streaming on an assistant component that has a later stream_event with matching message.id', () => {
    const src = ref([
      makeMessage({ type: 'assistant', message: { id: 'msg_5', content: [{ type: 'text', text: 'par' }] } }),
      makeMessage({ type: 'stream_event', message: { id: 'msg_5' }, delta: { type: 'text_delta', text: 'tial' } }),
    ])
    const { components } = useChatReducer(src)
    const txt = components.value.find(c => c.kind === 'block-text')!
    expect(txt.status).toBe('streaming')
  })

  it('marks the latest user message as sticky while any non-user components follow it', () => {
    const src = ref([
      makeMessage({ type: 'user', content: 'go' }),
      makeMessage({ type: 'assistant', message: { id: 'm', content: [{ type: 'text', text: 'yes' }] } }),
    ])
    const { components } = useChatReducer(src)
    const user = components.value.find(c => c.kind === 'user')!
    expect(user.sticky).toBe(true)
  })

  it('does not mark the user message as sticky if it is the last component', () => {
    const src = ref([makeMessage({ type: 'user', content: 'hi' })])
    const { components } = useChatReducer(src)
    expect(components.value[0].sticky).toBeUndefined()
  })

  it('marks active tool-confirmation as sticky', () => {
    const src = ref([makeMessage({ event: 'session:tool-confirmation', type: 'tool_confirmation', tool: 'Bash' })])
    const { components } = useChatReducer(src)
    expect(components.value[0].sticky).toBe(true)
  })
})

describe('useChatReducer — hook lifecycle (mutate)', () => {
  it('collapses hook_started + hook_progress + hook_response into a single component', () => {
    const src = ref([
      makeMessage({ type: 'system', subtype: 'hook_started', hook_callback_id: 'h1', hook_event: 'PostToolUse' }),
      makeMessage({ type: 'system', subtype: 'hook_progress', hook_callback_id: 'h1', progress: 'running' }),
      makeMessage({ type: 'system', subtype: 'hook_response', hook_callback_id: 'h1', decision: 'allow' }),
    ])
    const { components } = useChatReducer(src)
    expect(components.value.filter(c => c.kind === 'hook-entry')).toHaveLength(1)
    const entry = components.value.find(c => c.kind === 'hook-entry')!
    expect((entry.data as any).decision).toBe('allow')
    expect(entry.status).toBe('success')
  })
})
