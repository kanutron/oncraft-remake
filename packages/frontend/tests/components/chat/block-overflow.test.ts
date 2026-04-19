import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatBlockImage from '~/components/chat/ChatBlockImage.vue'
import ChatBlockRedactedThinking from '~/components/chat/ChatBlockRedactedThinking.vue'

describe('ChatBlockImage', () => {
  it('renders an img tag in full mode', async () => {
    const w = await mountSuspended(ChatBlockImage, {
      props: {
        componentKey: 'k',
        defaultMode: 'full',
        data: { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
      },
    })
    expect(w.find('img').exists()).toBe(true)
  })
})

describe('ChatBlockRedactedThinking', () => {
  it('shows a badge without content', async () => {
    const w = await mountSuspended(ChatBlockRedactedThinking, {
      props: { componentKey: 'k', defaultMode: 'badge', data: { type: 'redacted_thinking' } },
    })
    expect(w.text().toLowerCase()).toContain('redacted')
  })
})
