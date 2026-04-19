import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatResult from '~/components/chat/ChatResult.vue'

describe('ChatResult', () => {
  const successData = {
    type: 'result', subtype: 'success',
    total_cost_usd: 0.0123, duration_ms: 4200,
    usage: { input_tokens: 1234, output_tokens: 567 },
  }

  it('shows cost and tokens in compact mode', async () => {
    const w = await mountSuspended(ChatResult, {
      props: { componentKey: 'r1', defaultMode: 'compact', data: successData },
    })
    expect(w.text()).toContain('$0.01')
    expect(w.text()).toMatch(/1,?234/)
  })

  it('renders error variant when subtype starts with error_', async () => {
    const w = await mountSuspended(ChatResult, {
      props: { componentKey: 'r2', defaultMode: 'compact', data: { ...successData, subtype: 'error_max_turns' } },
    })
    expect(w.attributes('data-error')).toBe('true')
  })
})
