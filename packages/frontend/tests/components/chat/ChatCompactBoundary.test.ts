import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatCompactBoundary from '~/components/chat/ChatCompactBoundary.vue'

describe('ChatCompactBoundary', () => {
  it('renders a horizontal divider with label in badge mode', async () => {
    const w = await mountSuspended(ChatCompactBoundary, {
      props: { componentKey: 'cb1', defaultMode: 'badge', data: { type: 'system', subtype: 'compact_boundary', reason: 'tokens' } },
    })
    expect(w.text()).toContain('compact')
  })
})
