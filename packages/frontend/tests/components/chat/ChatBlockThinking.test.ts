import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatBlockThinking from '~/components/chat/ChatBlockThinking.vue'

describe('ChatBlockThinking', () => {
  const baseProps = { componentKey: 'k1', defaultMode: 'compact' as const, data: { type: 'thinking', thinking: 'let me think…' } }

  it('renders UChatReasoning in compact mode (collapsed)', async () => {
    const w = await mountSuspended(ChatBlockThinking, { props: baseProps })
    expect(w.attributes('data-mode')).toBe('compact')
    expect(w.findComponent({ name: 'UChatReasoning' }).exists()).toBe(true)
  })

  it('renders a badge in badge mode', async () => {
    const w = await mountSuspended(ChatBlockThinking, { props: { ...baseProps, defaultMode: 'badge' } })
    expect(w.attributes('data-mode')).toBe('badge')
  })
})
