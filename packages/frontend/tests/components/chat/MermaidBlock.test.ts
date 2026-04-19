import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import MermaidBlock from '~/components/chat/MermaidBlock.vue'

describe('MermaidBlock', () => {
  it('renders a placeholder container for a mermaid source', async () => {
    const wrapper = await mountSuspended(MermaidBlock, {
      props: { source: 'graph TD; A-->B' },
    })
    expect(wrapper.attributes('data-mermaid')).toBe('')
  })
})
