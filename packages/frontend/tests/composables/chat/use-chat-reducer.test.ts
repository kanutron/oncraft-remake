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
