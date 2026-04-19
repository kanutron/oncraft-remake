import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatBlockText from '~/components/chat/ChatBlockText.vue'
import { ensureMarkdown } from '~/composables/chat/markdown/use-markdown'

describe('ChatBlockText', () => {
  it('renders text in full mode', async () => {
    const wrapper = await mountSuspended(ChatBlockText, {
      props: { componentKey: 'k1', defaultMode: 'full', data: { type: 'text', text: 'hello world' } },
    })
    expect(wrapper.text()).toContain('hello')
  })

  it('renders markdown bold in full mode', async () => {
    await ensureMarkdown()
    const wrapper = await mountSuspended(ChatBlockText, {
      props: { componentKey: 'k1b', defaultMode: 'full', data: { type: 'text', text: 'hello **world**' } },
    })
    expect(wrapper.html()).toContain('<strong>world</strong>')
  })

  it('renders a fenced bash block in full mode', async () => {
    await ensureMarkdown()
    const wrapper = await mountSuspended(ChatBlockText, {
      props: { componentKey: 'k1c', defaultMode: 'full', data: { type: 'text', text: '```bash\necho hi\n```' } },
    })
    expect(wrapper.html()).toContain('echo')
  })

  it('truncates text in compact mode (plain, no markdown)', async () => {
    const wrapper = await mountSuspended(ChatBlockText, {
      props: { componentKey: 'k2', defaultMode: 'compact', data: { type: 'text', text: 'a'.repeat(500) } },
    })
    expect(wrapper.attributes('data-mode')).toBe('compact')
  })
})
