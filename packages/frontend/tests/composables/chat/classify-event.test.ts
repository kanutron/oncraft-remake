import { describe, it, expect } from 'vitest'
import { classifyEvent } from '~/composables/chat/classify-event'

describe('classifyEvent', () => {
  it('classifies an assistant message as fan-out with a message-id correlation key', () => {
    const event = { type: 'assistant', message: { id: 'msg_01' }, content: [] }
    const result = classifyEvent(event)
    expect(result).toEqual({
      relationship: 'fan-out',
      correlationKey: 'msg_01',
      kind: 'assistant',
      descriptor: expect.objectContaining({ sdkType: 'SDKAssistantMessage' }),
    })
  })

  it('classifies a user message as spawn with no correlation key', () => {
    const event = { type: 'user', content: 'hi' }
    expect(classifyEvent(event)).toEqual({
      relationship: 'spawn',
      correlationKey: undefined,
      kind: 'user',
      descriptor: expect.objectContaining({ sdkType: 'SDKUserMessage' }),
    })
  })

  it('classifies a stream_event as mutate keyed by message id', () => {
    const event = { type: 'stream_event', message: { id: 'msg_02' }, delta: {} }
    expect(classifyEvent(event)).toEqual({
      relationship: 'mutate',
      correlationKey: 'msg_02',
      kind: 'assistant',
      descriptor: expect.objectContaining({ sdkType: 'SDKPartialAssistantMessage' }),
    })
  })

  it('classifies system init as spawn', () => {
    const event = { type: 'system', subtype: 'init', model: 'claude-opus-4-7' }
    expect(classifyEvent(event).relationship).toBe('spawn')
    expect(classifyEvent(event).kind).toBe('system-init')
  })

  it('classifies system status as side-channel', () => {
    const event = { type: 'system', subtype: 'status', status: 'requesting' }
    expect(classifyEvent(event).relationship).toBe('side-channel')
  })

  it('classifies rate_limit_event as side-channel', () => {
    expect(classifyEvent({ type: 'rate_limit_event' }).relationship).toBe('side-channel')
  })

  it('classifies bridge:ready as discard', () => {
    expect(classifyEvent({ type: 'bridge:ready' }).relationship).toBe('discard')
  })

  it('classifies bridge:error as spawn', () => {
    expect(classifyEvent({ type: 'bridge:error', message: 'x' }).relationship).toBe('spawn')
  })

  it('returns null-descriptor entry for unknown events', () => {
    const result = classifyEvent({ type: 'totally_made_up' })
    expect(result).toEqual({
      relationship: 'discard',
      correlationKey: undefined,
      kind: 'generic-system',
      descriptor: null,
    })
  })

  it('matches the more specific subtype entry when both match', () => {
    // system/init has a dedicated descriptor; system without subtype does not.
    expect(classifyEvent({ type: 'system', subtype: 'init' }).kind).toBe('system-init')
  })
})
