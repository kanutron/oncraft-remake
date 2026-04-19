import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { setActivePinia, createPinia } from 'pinia'
import ChatToolConfirmation from '~/components/chat/ChatToolConfirmation.vue'

describe('ChatToolConfirmation', () => {
  // Matches the real bridge payload shape emitted by session-bridge.ts
  // (toolUseID / toolName / toolInput — mirrors SDK canUseTool args).
  const data = {
    type: 'tool_confirmation' as const,
    toolUseID: 'r1',
    toolName: 'Bash',
    toolInput: { command: 'rm -rf /' },
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('renders allow and deny buttons in full mode', async () => {
    const w = await mountSuspended(ChatToolConfirmation, {
      props: { componentKey: 'r1', defaultMode: 'full', sessionId: 's1', data },
    })
    expect(w.text()).toContain('Bash')
    expect(w.findAll('button').length).toBeGreaterThanOrEqual(2)
  })

  it('POSTs the decision using toolUseID when Allow is clicked', async () => {
    const fetchMock = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('$fetch', fetchMock)

    const w = await mountSuspended(ChatToolConfirmation, {
      props: { componentKey: 'r1', defaultMode: 'full', sessionId: 's1', data },
    })

    const allowBtn = w.findAll('button').find(b => b.text().includes('Allow'))!
    await allowBtn.trigger('click')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/sessions\/s1\/reply$/)
    expect(opts).toEqual({
      method: 'POST',
      body: { toolUseID: 'r1', decision: 'allow' },
    })
  })
})
