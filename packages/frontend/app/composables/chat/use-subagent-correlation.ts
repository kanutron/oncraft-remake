import { computed, type Ref, type ComputedRef } from 'vue'
import { useSessionStore, type SubagentEntry } from '~/stores/session.store'

/**
 * Correlates Agent tool_uses in an assistant chain to subagent transcripts
 * by (agentType, description). Falls back to positional pairing when the
 * same (type, description) pair is invoked multiple times.
 *
 * Runtime signal `parent_tool_use_id` is not available on subagent entries —
 * correlation uses `.meta.json` data matched against parent Agent tool_use.input.
 */
export function useSubagentCorrelation(sessionId: Ref<string>): ComputedRef<Map<string, SubagentEntry>> {
  const sessionStore = useSessionStore()

  return computed(() => {
    const rawMessages = sessionStore.messagesForSession(sessionId.value)
    const subagents = sessionStore.subagentsForSession(sessionId.value)
    const out = new Map<string, SubagentEntry>()
    if (subagents.length === 0) return out

    const queues = new Map<string, SubagentEntry[]>()
    for (const sa of subagents) {
      const key = `${sa.agentType ?? ''}|${sa.description ?? ''}`
      const queue = queues.get(key) ?? []
      queue.push(sa)
      queues.set(key, queue)
    }

    for (const msg of rawMessages) {
      const raw = ((msg.raw as Record<string, unknown>)?.data ?? msg.raw) as Record<string, unknown>
      if (raw?.type !== 'assistant') continue
      const message = raw?.message as { content?: unknown[] } | undefined
      const blocks = (message?.content ?? []) as Array<Record<string, unknown>>
      for (const b of blocks) {
        if (b?.type !== 'tool_use' || b?.name !== 'Agent') continue
        const id = b.id as string | undefined
        if (!id) continue
        const input = (b.input ?? {}) as { subagent_type?: string; description?: string }
        const key = `${input.subagent_type ?? ''}|${input.description ?? ''}`
        const queue = queues.get(key)
        const match = queue?.shift()
        if (match) out.set(id, match)
      }
    }
    return out
  })
}
