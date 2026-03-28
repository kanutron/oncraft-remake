import type { Session, SessionState, ChatMessage } from '~/types'

export const useSessionStore = defineStore('session', () => {
  const config = useRuntimeConfig()
  const sessions = ref<Map<string, Session>>(new Map())
  const messages = ref<Map<string, ChatMessage[]>>(new Map())
  const activeSessionByRepository = ref<Map<string, string>>(new Map())

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
  }

  function updateState(sessionId: string, state: SessionState) {
    const session = sessions.value.get(sessionId)
    if (session) {
      session.state = state
    }
  }

  return {
    sessions, messages, activeSessionByRepository,
    activeSessionId, sessionsForRepository, messagesForSession,
    fetchForRepository, create, send, reply, interrupt, setActive,
    appendMessage, updateState,
  }
})
