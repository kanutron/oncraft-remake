import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatBlockText from '~/components/chat/ChatBlockText.vue'

describe('ChatBlockText', () => {
  it('renders the text in full mode', async () => {
    const wrapper = await mountSuspended(ChatBlockText, {
      props: { componentKey: 'k1', defaultMode: 'full', data: { type: 'text', text: 'hello **world**' } },
    })
    expect(wrapper.text()).toContain('hello')
  })

  it('truncates text in compact mode', async () => {
    const wrapper = await mountSuspended(ChatBlockText, {
      props: { componentKey: 'k2', defaultMode: 'compact', data: { type: 'text', text: 'a'.repeat(500) } },
    })
    expect(wrapper.attributes('data-mode')).toBe('compact')
  })
})
