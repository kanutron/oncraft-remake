import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatBlockToolUse from '~/components/chat/ChatBlockToolUse.vue'

function props(mode: 'badge' | 'compact' | 'full', overrides: Record<string, unknown> = {}) {
  return {
    componentKey: 't1',
    defaultMode: mode,
    status: 'success' as const,
    data: { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' }, ...overrides },
  }
}

describe('ChatBlockToolUse', () => {
  it('renders as an inline-flex badge in badge mode', async () => {
    const w = await mountSuspended(ChatBlockToolUse, { props: props('badge') })
    expect(w.attributes('data-mode')).toBe('badge')
    expect(w.attributes('class')).toContain('inline-flex')
  })

  it('renders a UChatTool in compact mode', async () => {
    const w = await mountSuspended(ChatBlockToolUse, { props: props('compact') })
    expect(w.attributes('data-mode')).toBe('compact')
    expect(w.findComponent({ name: 'UChatTool' }).exists()).toBe(true)
  })

  it('renders full output when mode=full and a tool_result exists', async () => {
    const w = await mountSuspended(ChatBlockToolUse, {
      props: props('full', { tool_result: { content: 'stdout output', is_error: false } }),
    })
    expect(w.text()).toContain('stdout output')
  })

  it('shows error styling when status=error', async () => {
    const w = await mountSuspended(ChatBlockToolUse, {
      props: { ...props('compact'), status: 'error' as const },
    })
    expect(w.attributes('data-status')).toBe('error')
  })

  it('passes streaming=true to UChatTool when status=streaming in compact/full', async () => {
    const w = await mountSuspended(ChatBlockToolUse, {
      props: { ...props('compact'), status: 'streaming' as const },
    })
    const tool = w.findComponent({ name: 'UChatTool' })
    expect(tool.props('streaming')).toBe(true)
  })
})
