import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatBridgeError from '~/components/chat/ChatBridgeError.vue'

describe('ChatBridgeError', () => {
  it('renders the message in full mode with error styling', async () => {
    const w = await mountSuspended(ChatBridgeError, {
      props: { componentKey: 'e1', defaultMode: 'full', data: { type: 'bridge:error', message: 'network lost' } },
    })
    expect(w.text()).toContain('network lost')
  })
})
