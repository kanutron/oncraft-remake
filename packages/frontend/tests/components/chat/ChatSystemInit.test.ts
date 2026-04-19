import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatSystemInit from '~/components/chat/ChatSystemInit.vue'

describe('ChatSystemInit', () => {
  const baseData = {
    type: 'system', subtype: 'init',
    model: 'claude-opus-4-7', cwd: '/work/repo', tools: ['Read', 'Edit', 'Bash'],
  }

  it('shows model and cwd in compact mode', async () => {
    const w = await mountSuspended(ChatSystemInit, {
      props: { componentKey: 'i1', defaultMode: 'compact', data: baseData },
    })
    expect(w.text()).toContain('claude-opus-4-7')
    expect(w.text()).toContain('/work/repo')
  })

  it('lists tools in full mode', async () => {
    const w = await mountSuspended(ChatSystemInit, {
      props: { componentKey: 'i2', defaultMode: 'full', data: baseData },
    })
    for (const tool of baseData.tools) expect(w.text()).toContain(tool)
  })
})
