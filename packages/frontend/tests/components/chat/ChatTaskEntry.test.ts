import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatTaskEntry from '~/components/chat/ChatTaskEntry.vue'

describe('ChatTaskEntry', () => {
  it('shows task description and progress', async () => {
    const w = await mountSuspended(ChatTaskEntry, {
      props: { componentKey: 'task_1', defaultMode: 'compact', status: 'running',
        data: { type: 'task_progress', task_id: 'task_1', description: 'Refactor auth', progress: '50%' } },
    })
    expect(w.text()).toContain('Refactor auth')
    expect(w.text()).toContain('50%')
  })
})
