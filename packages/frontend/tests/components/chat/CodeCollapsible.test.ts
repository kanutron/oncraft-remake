import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CodeCollapsible from '~/components/chat/CodeCollapsible.vue'

describe('CodeCollapsible', () => {
  it('shows inline when line count is below threshold', async () => {
    const wrapper = await mountSuspended(CodeCollapsible, {
      props: { html: '<pre><code>one\ntwo</code></pre>', lineCount: 2 },
    })
    expect(wrapper.attributes('data-collapsed')).toBe('false')
  })

  it('collapses when line count exceeds threshold', async () => {
    const wrapper = await mountSuspended(CodeCollapsible, {
      props: { html: '<pre><code>' + 'a\n'.repeat(50) + '</code></pre>', lineCount: 50 },
    })
    expect(wrapper.attributes('data-collapsed')).toBe('true')
  })
})
