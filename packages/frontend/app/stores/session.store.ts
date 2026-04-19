import type { Session, SessionState, ChatMessage } from '~/types'

export interface SubagentEntry {
  agentId: string
  agentType?: string
  description?: string
  messages: Record<string, unknown>[]
}

export const useSessionStore = defineStore('session', () => {
  const config = useRuntimeConfig()
  const sessions = ref<Map<string, Session>>(new Map())
  const messages = ref<Map<string, ChatMessage[]>>(new Map())
  const activeSessionByRepository = ref<Map<string, string>>(new Map())
  const hydratedSessions = ref<Set<string>>(new Set())
  const hydratedSubagents = ref<Set<string>>(new Set())
  const subagentsBySession = ref<Map<string, SubagentEntry[]>>(new Map())
  // Live SDK events that carry parent_tool_use_id, indexed by that id so the
  // parent Agent tool_use can render the subagent transcript in real time
  // without waiting for hydration from the .jsonl transcript on disk.
  const liveSubagentsByToolUseId = ref<Map<string, Record<string, unknown>[]>>(new Map())

  function activeSessionId(repositoryId: string): string | null {
    return activeSessionByRepository.value.get(repositoryId) ?? null
  }

  function sessionsForRepository(repositoryId: string): Session[] {
    return Array.from(sessions.value.values())
      .filter(s => s.repositoryId === repositoryId)
      .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime())
  }

  function messagesForSession(sessionId: string): ChatMessage[] {
    return messages.value.get(sessionId) ?? []
  }

  async function fetchForRepository(repositoryId: string) {
    const data = await $fetch<Session[]>(`${config.public.backendUrl}/repositories/${repositoryId}/sessions`)
    for (const s of data) {
      sessions.value.set(s.id, s)
    }
  }

  async function create(repositoryId: string, opts: { name: string; sourceBranch: string; workBranch?: string; targetBranch?: string }) {
    const session = await $fetch<Session>(`${config.public.backendUrl}/repositories/${repositoryId}/sessions`, {
      method: 'POST',
      body: opts,
    })
    sessions.value.set(session.id, session)
    activeSessionByRepository.value.set(repositoryId, session.id)
    return session
  }

  async function send(sessionId: string, message: string, opts: { model?: string; effort?: string } = {}) {
    await $fetch(`${config.public.backendUrl}/sessions/${sessionId}/send`, {
      method: 'POST',
      body: { message, ...opts },
    })
  }

  async function reply(sessionId: string, toolUseID: string, decision: 'allow' | 'deny') {
    await $fetch(`${config.public.backendUrl}/sessions/${sessionId}/reply`, {
      method: 'POST',
      body: { toolUseID, decision },
    })
  }

  async function interrupt(sessionId: string) {
    await $fetch(`${config.public.backendUrl}/sessions/${sessionId}/interrupt`, { method: 'POST' })
  }

  function setActive(repositoryId: string, sessionId: string) {
    activeSessionByRepository.value.set(repositoryId, sessionId)
    void hydrate(sessionId)
    void hydrateSubagents(sessionId)
  }

  async function hydrate(sessionId: string) {
    if (hydratedSessions.value.has(sessionId)) return
    const session = sessions.value.get(sessionId)
    if (!session?.claudeSessionId) return
    if (session.state === 'active' || session.state === 'starting') return
    if ((messages.value.get(sessionId)?.length ?? 0) > 0) return

    hydratedSessions.value.add(sessionId)
    try {
      await $fetch(`${config.public.backendUrl}/sessions/${sessionId}/history`)
    }
    catch {
      hydratedSessions.value.delete(sessionId)
    }
  }

  async function hydrateSubagents(sessionId: string) {
    if (hydratedSubagents.value.has(sessionId)) return
    const session = sessions.value.get(sessionId)
    if (!session?.claudeSessionId) return

    hydratedSubagents.value.add(sessionId)
    try {
      await $fetch(`${config.public.backendUrl}/sessions/${sessionId}/subagents`)
    }
    catch {
      hydratedSubagents.value.delete(sessionId)
    }
  }

  function setSubagents(sessionId: string, entries: SubagentEntry[]) {
    subagentsBySession.value.set(sessionId, entries)
  }

  function subagentsForSession(sessionId: string): SubagentEntry[] {
    return subagentsBySession.value.get(sessionId) ?? []
  }

  function appendHistoryMessages(sessionId: string, rawMessages: Record<string, unknown>[]) {
    for (const raw of rawMessages) {
      appendMessage(sessionId, raw)
    }
  }

  function appendMessage(sessionId: string, raw: Record<string, unknown>) {
    if (!messages.value.has(sessionId)) {
      messages.value.set(sessionId, [])
    }
    messages.value.get(sessionId)!.push({
      id: crypto.randomUUID(),
      sessionId,
      timestamp: new Date().toISOString(),
      raw,
    })

    const parentId = (raw as { parent_tool_use_id?: unknown }).parent_tool_use_id
    if (typeof parentId === 'string' && parentId) {
      if (!liveSubagentsByToolUseId.value.has(parentId)) {
        liveSubagentsByToolUseId.value.set(parentId, [])
      }
      liveSubagentsByToolUseId.value.get(parentId)!.push(raw)
    }
  }

  function liveSubagentMessagesFor(toolUseId: string): Record<string, unknown>[] {
    return liveSubagentsByToolUseId.value.get(toolUseId) ?? []
  }

  function updateState(sessionId: string, state: SessionState) {
    const session = sessions.value.get(sessionId)
    if (session) {
      session.state = state
    }
  }

  async function destroy(sessionId: string, opts: { force?: boolean } = {}) {
    const session = sessions.value.get(sessionId)
    const query = opts.force ? '?force=true' : ''
    const response = await $fetch.raw(`${config.public.backendUrl}/sessions/${sessionId}${query}`, {
      method: 'DELETE',
      ignoreResponseError: true,
    })

    if (response.status === 409) {
      const body = response._data as { error: string; code: string }
      return { blocked: true as const, reason: body.error }
    }

    if (session) {
      removeSession(sessionId, session.repositoryId)
    }

    return { blocked: false as const }
  }

  async function updatePreferences(
    sessionId: string,
    prefs: {
      preferredModel?: string | null
      preferredEffort?: string | null
      preferredPermissionMode?: string | null
      thinkingMode?: 'off' | 'adaptive' | 'fixed' | null
      thinkingBudget?: number | null
    },
  ) {
    const updated = await $fetch<Session>(
      `${config.public.backendUrl}/sessions/${sessionId}/preferences`,
      { method: 'PATCH', body: prefs },
    )
    sessions.value.set(sessionId, updated)
  }

  function removeSession(sessionId: string, repositoryId: string) {
    sessions.value.delete(sessionId)
    messages.value.delete(sessionId)
    subagentsBySession.value.delete(sessionId)
    hydratedSubagents.value.delete(sessionId)
    // Live subagent entries are not session-keyed, but a deleted session
    // can't reference them anyway; leaving them is a minor leak that
    // clears on reload. Skipping surgical cleanup to avoid walking.

    // If deleted session was active, switch to another
    if (activeSessionByRepository.value.get(repositoryId) === sessionId) {
      const remaining = sessionsForRepository(repositoryId)
      if (remaining.length > 0) {
        activeSessionByRepository.value.set(repositoryId, remaining[0].id)
      }
      else {
        activeSessionByRepository.value.delete(repositoryId)
      }
    }
  }

  return {
    sessions, messages, activeSessionByRepository, hydratedSessions,
    hydratedSubagents, subagentsBySession, liveSubagentsByToolUseId,
    activeSessionId, sessionsForRepository, messagesForSession,
    subagentsForSession, liveSubagentMessagesFor,
    fetchForRepository, create, send, reply, interrupt, setActive, hydrate,
    hydrateSubagents, setSubagents,
    appendMessage, appendHistoryMessages, updateState, updatePreferences, destroy, removeSession,
  }
})
