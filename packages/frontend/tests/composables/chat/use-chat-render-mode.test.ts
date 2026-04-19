import { describe, it, expect, beforeEach } from 'vitest'
import { useChatRenderMode } from '~/composables/chat/use-chat-render-mode'

describe('useChatRenderMode', () => {
  beforeEach(() => {
    useChatRenderMode().resetAll()
  })

  it('returns the default mode when no override exists', () => {
    const { mode } = useChatRenderMode().useRenderMode('comp_1', 'badge')
    expect(mode.value).toBe('badge')
  })

  it('returns the override when set', () => {
    const api = useChatRenderMode().useRenderMode('comp_1', 'badge')
    api.setMode('full')
    expect(api.mode.value).toBe('full')
  })

  it('reset clears the override and returns to default', () => {
    const api = useChatRenderMode().useRenderMode('comp_1', 'badge')
    api.setMode('full')
    api.reset()
    expect(api.mode.value).toBe('badge')
  })

  it('respects sticky mode override (forces compact) when sticky=true', () => {
    const api = useChatRenderMode().useRenderMode('comp_1', 'full', { sticky: true })
    expect(api.mode.value).toBe('compact')
  })

  it('user override still wins over sticky', () => {
    const api = useChatRenderMode().useRenderMode('comp_1', 'full', { sticky: true })
    api.setMode('full')
    expect(api.mode.value).toBe('full')
  })

  it('different componentKeys have independent state', () => {
    const a = useChatRenderMode().useRenderMode('a', 'badge')
    const b = useChatRenderMode().useRenderMode('b', 'badge')
    a.setMode('full')
    expect(a.mode.value).toBe('full')
    expect(b.mode.value).toBe('badge')
  })
})
