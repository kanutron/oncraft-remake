import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatUserReplay from '~/components/chat/ChatUserReplay.vue'

describe('ChatUserReplay', () => {
  it('renders user text with a replay marker', async () => {
    const w = await mountSuspended(ChatUserReplay, {
      props: { componentKey: 'u_r', defaultMode: 'full', data: { type: 'user_replay', message: { content: 'previously said' } } },
    })
    expect(w.text()).toContain('previously said')
    expect(w.text().toLowerCase()).toContain('replay')
  })
})
