import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import { useSessionStore } from '~/stores/session.store'
import { useSubagentCorrelation } from '~/composables/chat/use-subagent-correlation'

function makeRaw(raw: unknown) {
  return { id: crypto.randomUUID(), sessionId: 's1', timestamp: new Date().toISOString(), raw: raw as any }
}

describe('useSubagentCorrelation', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('returns an empty map when there are no subagents', () => {
    const store = useSessionStore()
    store.messages.set('s1', [
      makeRaw({ type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 'tu_1', name: 'Agent', input: { subagent_type: 'explorer', description: 'hi' } }] } }),
    ])
    const map = useSubagentCorrelation(ref('s1'))
    expect(map.value.size).toBe(0)
  })

  it('correlates a single Agent tool_use to its subagent by (agentType, description)', () => {
    const store = useSessionStore()
    store.messages.set('s1', [
      makeRaw({
        type: 'assistant',
        message: {
          id: 'm1',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'Agent', input: { subagent_type: 'Explore', description: 'Audit CSS' } }],
        },
      }),
    ])
    store.setSubagents('s1', [
      { agentId: 'a1', agentType: 'Explore', description: 'Audit CSS', messages: [] },
    ])
    const map = useSubagentCorrelation(ref('s1'))
    expect(map.value.get('tu_1')?.agentId).toBe('a1')
  })

  it('uses positional pairing for duplicate (type, description) invocations', () => {
    const store = useSessionStore()
    store.messages.set('s1', [
      makeRaw({
        type: 'assistant',
        message: {
          id: 'm1',
          content: [
            { type: 'tool_use', id: 'tu_1', name: 'Agent', input: { subagent_type: 'Explore', description: 'Find X' } },
            { type: 'tool_use', id: 'tu_2', name: 'Agent', input: { subagent_type: 'Explore', description: 'Find X' } },
          ],
        },
      }),
    ])
    store.setSubagents('s1', [
      { agentId: 'a1', agentType: 'Explore', description: 'Find X', messages: [] },
      { agentId: 'a2', agentType: 'Explore', description: 'Find X', messages: [] },
    ])
    const map = useSubagentCorrelation(ref('s1'))
    expect(map.value.get('tu_1')?.agentId).toBe('a1')
    expect(map.value.get('tu_2')?.agentId).toBe('a2')
  })

  it('ignores non-Agent tool_uses', () => {
    const store = useSessionStore()
    store.messages.set('s1', [
      makeRaw({
        type: 'assistant',
        message: { id: 'm', content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: {} }] },
      }),
    ])
    store.setSubagents('s1', [{ agentId: 'a1', agentType: 'Explore', description: 'x', messages: [] }])
    const map = useSubagentCorrelation(ref('s1'))
    expect(map.value.size).toBe(0)
  })
})
