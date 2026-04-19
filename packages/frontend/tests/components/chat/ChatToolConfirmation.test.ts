import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatToolConfirmation from '~/components/chat/ChatToolConfirmation.vue'

describe('ChatToolConfirmation', () => {
  const data = { type: 'tool_confirmation' as const, request_id: 'r1', tool: 'Bash', input: { command: 'rm -rf /' } }

  it('renders allow and deny buttons in full mode', async () => {
    const w = await mountSuspended(ChatToolConfirmation, {
      props: { componentKey: 'r1', defaultMode: 'full', sessionId: 's1', data },
    })
    expect(w.text()).toContain('Bash')
    expect(w.findAll('button').length).toBeGreaterThanOrEqual(2)
  })
})
