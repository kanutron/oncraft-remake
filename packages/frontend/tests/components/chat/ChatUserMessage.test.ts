import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatUserMessage from '~/components/chat/ChatUserMessage.vue'

describe('ChatUserMessage', () => {
  it('extracts text from a user prompt and renders via UChatMessage', async () => {
    const w = await mountSuspended(ChatUserMessage, {
      props: {
        componentKey: 'u1',
        defaultMode: 'full',
        data: { type: 'user', message: { content: 'hi there' } },
      },
    })
    expect(w.text()).toContain('hi there')
  })

  it('renders compact style when sticky prop is true', async () => {
    const w = await mountSuspended(ChatUserMessage, {
      props: {
        componentKey: 'u2',
        defaultMode: 'full',
        sticky: true,
        data: { type: 'user', message: { content: 'hi' } },
      },
    })
    expect(w.attributes('data-mode')).toBe('compact')
  })
})
