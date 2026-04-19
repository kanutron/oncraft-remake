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
    expect(components.value).toHaveLength(2)
    expect(components.value[0].kind).toBe('block-text')
    expect(components.value[1].kind).toBe('block-tool-use')
    expect(components.value[1].componentKey).toBe('tool_a') // tool_use_id for correlation
  })

  it('falls back to index-based key for blocks with no id', () => {
    const src = ref([makeMessage({
      type: 'assistant',
      message: { id: 'msg_2', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
    })])
    const { components } = useChatReducer(src)
    expect(components.value.map(c => c.componentKey)).toEqual(['msg_2:0', 'msg_2:1'])
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
    expect(components.value.map(c => c.defaultMode)).toEqual(['full', 'compact', 'badge'])
  })
})
