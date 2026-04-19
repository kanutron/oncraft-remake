import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatAPIRetry from '~/components/chat/ChatAPIRetry.vue'
import ChatLocalCommandOutput from '~/components/chat/ChatLocalCommandOutput.vue'
import ChatNotification from '~/components/chat/ChatNotification.vue'
import ChatToolUseSummary from '~/components/chat/ChatToolUseSummary.vue'

describe('ChatAPIRetry', () => {
  it('shows retry attempt and error', async () => {
    const w = await mountSuspended(ChatAPIRetry, {
      props: { componentKey: 'k', defaultMode: 'compact', data: { type: 'system', subtype: 'api_retry', attempt: 2, error: 'timeout' } },
    })
    expect(w.text()).toContain('retry')
    expect(w.text()).toContain('timeout')
  })
})

describe('ChatLocalCommandOutput', () => {
  it('shows the command output', async () => {
    const w = await mountSuspended(ChatLocalCommandOutput, {
      props: { componentKey: 'k', defaultMode: 'compact', data: { type: 'system', subtype: 'local_command_output', command: '/help', stdout: 'help text' } },
    })
    expect(w.text()).toContain('/help')
  })
})

describe('ChatNotification', () => {
  it('renders the message', async () => {
    const w = await mountSuspended(ChatNotification, {
      props: { componentKey: 'k', defaultMode: 'compact', data: { type: 'system', subtype: 'notification', message: 'Hello' } },
    })
    expect(w.text()).toContain('Hello')
  })
})

describe('ChatToolUseSummary', () => {
  it('shows the summary count', async () => {
    const w = await mountSuspended(ChatToolUseSummary, {
      props: { componentKey: 'k', defaultMode: 'compact', data: { type: 'tool_use_summary', count: 12 } },
    })
    expect(w.text()).toContain('12')
  })
})
