import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatHookEntry from '~/components/chat/ChatHookEntry.vue'

describe('ChatHookEntry', () => {
  it('shows the hook event name and final decision in compact mode', async () => {
    const w = await mountSuspended(ChatHookEntry, {
      props: {
        componentKey: 'h1', defaultMode: 'compact', status: 'success',
        data: { type: 'system', subtype: 'hook_response', hook_callback_id: 'h1', hook_event: 'PostToolUse', decision: 'allow' },
      },
    })
    expect(w.text()).toContain('PostToolUse')
    expect(w.text()).toContain('allow')
  })
})
