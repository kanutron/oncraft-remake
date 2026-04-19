import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import RichMarkdown from '~/components/chat/RichMarkdown.vue'
import { ensureMarkdown } from '~/composables/chat/markdown/use-markdown'

describe('RichMarkdown', () => {
  it('renders bold markdown', async () => {
    await ensureMarkdown()
    const wrapper = await mountSuspended(RichMarkdown, {
      props: { source: 'hello **world**' },
    })
    expect(wrapper.html()).toContain('<strong>world</strong>')
  })

  it('renders a fenced bash code block', async () => {
    await ensureMarkdown()
    const wrapper = await mountSuspended(RichMarkdown, {
      props: { source: '```bash\necho hi\n```' },
    })
    expect(wrapper.html()).toContain('echo')
  })

  it('uses the prose container', async () => {
    const wrapper = await mountSuspended(RichMarkdown, {
      props: { source: 'x' },
    })
    expect(wrapper.classes()).toContain('prose')
  })
})
