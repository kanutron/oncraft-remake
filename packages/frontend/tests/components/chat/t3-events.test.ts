import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatMemoryRecall from '~/components/chat/ChatMemoryRecall.vue'
import ChatElicitationComplete from '~/components/chat/ChatElicitationComplete.vue'
import ChatGenericSystemEvent from '~/components/chat/ChatGenericSystemEvent.vue'

describe('ChatMemoryRecall', () => {
  it('shows memory path', async () => {
    const w = await mountSuspended(ChatMemoryRecall, {
      props: { componentKey: 'k', defaultMode: 'badge', data: { type: 'system', subtype: 'memory_recall', path: 'user/pref.md' } },
    })
    expect(w.text()).toContain('memory')
  })
})

describe('ChatElicitationComplete', () => {
  it('shows elicitation result', async () => {
    const w = await mountSuspended(ChatElicitationComplete, {
      props: { componentKey: 'k', defaultMode: 'compact', data: { type: 'system', subtype: 'elicitation_complete', result: 'ok' } },
    })
    expect(w.text().toLowerCase()).toContain('elicitation')
  })
})

describe('ChatGenericSystemEvent', () => {
  it('falls back with type + subtype', async () => {
    const w = await mountSuspended(ChatGenericSystemEvent, {
      props: { componentKey: 'k', defaultMode: 'badge', data: { type: 'system', subtype: 'plugin_install', plugin: 'x' } },
    })
    expect(w.text()).toContain('plugin_install')
  })
})
