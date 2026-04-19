import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Session, SessionState } from '~/types'

// Import the store — auto-imports are polyfilled by tests/setup.ts
import { useSessionStore } from '~/stores/session.store'

/* ── Helpers ──────────────────────────────────────────────────────── */

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    repositoryId: 'ws-1',
    claudeSessionId: null,
    name: 'test-session',
    sourceBranch: 'main',
    workBranch: null,
    targetBranch: 'feat/test',
    worktreePath: null,
    state: 'idle',
    createdAt: '2025-01-01T00:00:00Z',
    lastActivityAt: '2025-01-01T00:00:00Z',
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    ...overrides,
  }
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe('useSessionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  /* ── create ────────────────────────────────────────────────────── */

  describe('create()', () => {
    it('adds a session and sets it active for the repository', async () => {
      const session = makeSession({ id: 'sess-1', repositoryId: 'ws-1' })
      vi.stubGlobal('$fetch', vi.fn().mockResolvedValueOnce(session))

      const store = useSessionStore()
      const result = await store.create('ws-1', {
        name: 'test',
        sourceBranch: 'main',
        targetBranch: 'feat/test',
      })

      expect(result).toEqual(session)
      expect(store.sessions.get('sess-1')).toEqual(session)
      expect(store.activeSessionId('ws-1')).toBe('sess-1')
    })

    it('sends POST to the correct endpoint with body', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(makeSession())
      vi.stubGlobal('$fetch', fetchMock)

      const store = useSessionStore()
      const opts = {
        name: 'my-session',
        sourceBranch: 'main',
        targetBranch: 'feat/work',
      }
      await store.create('ws-42', opts)

      expect(fetchMock).toHaveBeenCalledWith(
        'http://test:3101/repositories/ws-42/sessions',
        { method: 'POST', body: opts },
      )
    })
  })

  /* ── fetchForRepository ────────────────────────────────────────── */

  describe('fetchForRepository()', () => {
    it('populates sessions from the API', async () => {
      const s1 = makeSession({ id: 'sess-1', repositoryId: 'ws-1' })
      const s2 = makeSession({ id: 'sess-2', repositoryId: 'ws-1' })
      vi.stubGlobal('$fetch', vi.fn().mockResolvedValueOnce([s1, s2]))

      const store = useSessionStore()
      await store.fetchForRepository('ws-1')

      expect(store.sessions.size).toBe(2)
      expect(store.sessions.get('sess-1')).toEqual(s1)
      expect(store.sessions.get('sess-2')).toEqual(s2)
    })

    it('calls the correct endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce([])
      vi.stubGlobal('$fetch', fetchMock)

      const store = useSessionStore()
      await store.fetchForRepository('ws-7')

      expect(fetchMock).toHaveBeenCalledWith(
        'http://test:3101/repositories/ws-7/sessions',
      )
    })

    it('merges with existing sessions (does not clear others)', async () => {
      const existing = makeSession({ id: 'sess-existing', repositoryId: 'ws-other' })
      const fetched = makeSession({ id: 'sess-new', repositoryId: 'ws-1' })
      vi.stubGlobal('$fetch', vi.fn().mockResolvedValueOnce([fetched]))

      const store = useSessionStore()
      store.sessions.set('sess-existing', existing)

      await store.fetchForRepository('ws-1')

      expect(store.sessions.size).toBe(2)
      expect(store.sessions.has('sess-existing')).toBe(true)
      expect(store.sessions.has('sess-new')).toBe(true)
    })
  })

  /* ── appendMessage ─────────────────────────────────────────────── */

  describe('appendMessage()', () => {
    it('accumulates messages for a session', () => {
      const store = useSessionStore()

      store.appendMessage('sess-1', { type: 'text', text: 'hello' })
      store.appendMessage('sess-1', { type: 'text', text: 'world' })

      const msgs = store.messagesForSession('sess-1')
      expect(msgs).toHaveLength(2)
      expect(msgs[0].raw).toEqual({ type: 'text', text: 'hello' })
      expect(msgs[1].raw).toEqual({ type: 'text', text: 'world' })
    })

    it('assigns unique ids and sessionId to each message', () => {
      const store = useSessionStore()

      store.appendMessage('sess-1', { type: 'text' })
      store.appendMessage('sess-1', { type: 'text' })

      const msgs = store.messagesForSession('sess-1')
      expect(msgs[0].id).toBeTruthy()
      expect(msgs[1].id).toBeTruthy()
      expect(msgs[0].id).not.toBe(msgs[1].id)
      expect(msgs[0].sessionId).toBe('sess-1')
    })

    it('assigns a timestamp to each message', () => {
      const store = useSessionStore()
      store.appendMessage('sess-1', { type: 'text' })

      const msgs = store.messagesForSession('sess-1')
      expect(msgs[0].timestamp).toBeTruthy()
      // Should be a valid ISO string
      expect(new Date(msgs[0].timestamp).toISOString()).toBe(msgs[0].timestamp)
    })

    it('keeps messages for different sessions separate', () => {
      const store = useSessionStore()

      store.appendMessage('sess-1', { text: 'a' })
      store.appendMessage('sess-2', { text: 'b' })

      expect(store.messagesForSession('sess-1')).toHaveLength(1)
      expect(store.messagesForSession('sess-2')).toHaveLength(1)
      expect(store.messagesForSession('sess-1')[0].raw).toEqual({ text: 'a' })
      expect(store.messagesForSession('sess-2')[0].raw).toEqual({ text: 'b' })
    })
  })

  /* ── updateState ───────────────────────────────────────────────── */

  describe('updateState()', () => {
    it('updates the session state', () => {
      const store = useSessionStore()
      const session = makeSession({ id: 'sess-1', state: 'idle' })
      store.sessions.set('sess-1', session)

      store.updateState('sess-1', 'active')

      expect(store.sessions.get('sess-1')!.state).toBe('active')
    })

    it('handles all valid session states', () => {
      const store = useSessionStore()
      const states: SessionState[] = ['idle', 'starting', 'active', 'stopped', 'error', 'completed']

      for (const state of states) {
        const session = makeSession({ id: 'sess-1', state: 'idle' })
        store.sessions.set('sess-1', session)
        store.updateState('sess-1', state)
        expect(store.sessions.get('sess-1')!.state).toBe(state)
      }
    })

    it('is a no-op when the session does not exist', () => {
      const store = useSessionStore()
      // Should not throw
      store.updateState('nonexistent', 'active')
      expect(store.sessions.size).toBe(0)
    })
  })

  /* ── sessionsForRepository ─────────────────────────────────────── */

  describe('sessionsForRepository()', () => {
    it('filters sessions by repositoryId', () => {
      const store = useSessionStore()
      store.sessions.set('s1', makeSession({ id: 's1', repositoryId: 'ws-1' }))
      store.sessions.set('s2', makeSession({ id: 's2', repositoryId: 'ws-2' }))
      store.sessions.set('s3', makeSession({ id: 's3', repositoryId: 'ws-1' }))

      const result = store.sessionsForRepository('ws-1')
      expect(result).toHaveLength(2)
      expect(result.map(s => s.id).sort()).toEqual(['s1', 's3'])
    })

    it('returns empty array for unknown repository', () => {
      const store = useSessionStore()
      expect(store.sessionsForRepository('ws-unknown')).toEqual([])
    })

    it('sorts by lastActivityAt descending (most recent first)', () => {
      const store = useSessionStore()
      store.sessions.set('s1', makeSession({ id: 's1', repositoryId: 'ws-1', lastActivityAt: '2024-01-01T00:00:00Z' }))
      store.sessions.set('s2', makeSession({ id: 's2', repositoryId: 'ws-1', lastActivityAt: '2025-06-01T00:00:00Z' }))
      store.sessions.set('s3', makeSession({ id: 's3', repositoryId: 'ws-1', lastActivityAt: '2025-03-01T00:00:00Z' }))

      const result = store.sessionsForRepository('ws-1')
      expect(result.map(s => s.id)).toEqual(['s2', 's3', 's1'])
    })
  })

  /* ── messagesForSession ────────────────────────────────────────── */

  describe('messagesForSession()', () => {
    it('returns messages for the given session', () => {
      const store = useSessionStore()
      store.appendMessage('sess-1', { text: 'hello' })
      store.appendMessage('sess-1', { text: 'world' })

      const msgs = store.messagesForSession('sess-1')
      expect(msgs).toHaveLength(2)
    })

    it('returns empty array for session with no messages', () => {
      const store = useSessionStore()
      expect(store.messagesForSession('nonexistent')).toEqual([])
    })
  })

  /* ── activeSessionId ───────────────────────────────────────────── */

  describe('activeSessionId()', () => {
    it('returns the active session for a repository', () => {
      const store = useSessionStore()
      store.setActive('ws-1', 'sess-5')
      expect(store.activeSessionId('ws-1')).toBe('sess-5')
    })

    it('returns null when no session is active for the repository', () => {
      const store = useSessionStore()
      expect(store.activeSessionId('ws-unknown')).toBeNull()
    })
  })

  /* ── setActive ─────────────────────────────────────────────────── */

  describe('setActive()', () => {
    it('sets the active session for a repository', () => {
      const store = useSessionStore()
      store.setActive('ws-1', 'sess-a')
      expect(store.activeSessionId('ws-1')).toBe('sess-a')

      store.setActive('ws-1', 'sess-b')
      expect(store.activeSessionId('ws-1')).toBe('sess-b')
    })

    it('supports different active sessions per repository', () => {
      const store = useSessionStore()
      store.setActive('ws-1', 'sess-a')
      store.setActive('ws-2', 'sess-b')

      expect(store.activeSessionId('ws-1')).toBe('sess-a')
      expect(store.activeSessionId('ws-2')).toBe('sess-b')
    })
  })

  /* ── hydrate ───────────────────────────────────────────────────── */

  describe('hydrate()', () => {
    it('skips when session is unknown', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('$fetch', fetchMock)

      const store = useSessionStore()
      await store.hydrate('unknown')

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('skips when claudeSessionId is null', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('$fetch', fetchMock)

      const store = useSessionStore()
      store.sessions.set('sess-1', makeSession({ id: 'sess-1', claudeSessionId: null }))
      await store.hydrate('sess-1')

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('skips when session state is active', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('$fetch', fetchMock)

      const store = useSessionStore()
      store.sessions.set('sess-1', makeSession({ id: 'sess-1', claudeSessionId: 'claude-1', state: 'active' as SessionState }))
      await store.hydrate('sess-1')

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('skips when messages already exist', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('$fetch', fetchMock)

      const store = useSessionStore()
      store.sessions.set('sess-1', makeSession({ id: 'sess-1', claudeSessionId: 'claude-1' }))
      store.appendMessage('sess-1', { type: 'assistant' })
      await store.hydrate('sess-1')

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('fires GET /sessions/:id/history once, idempotent on second call', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ sessionId: 'sess-1', status: 'loading' })
      vi.stubGlobal('$fetch', fetchMock)

      const store = useSessionStore()
      store.sessions.set('sess-1', makeSession({ id: 'sess-1', claudeSessionId: 'claude-1' }))

      await store.hydrate('sess-1')
      await store.hydrate('sess-1')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith('http://test:3101/sessions/sess-1/history')
      expect(store.hydratedSessions.has('sess-1')).toBe(true)
    })

    it('clears hydration flag on fetch failure so retry is possible', async () => {
      const fetchMock = vi.fn().mockRejectedValueOnce(new Error('boom'))
      vi.stubGlobal('$fetch', fetchMock)

      const store = useSessionStore()
      store.sessions.set('sess-1', makeSession({ id: 'sess-1', claudeSessionId: 'claude-1' }))
      await store.hydrate('sess-1')

      expect(store.hydratedSessions.has('sess-1')).toBe(false)
    })
  })

  /* ── appendHistoryMessages ─────────────────────────────────────── */

  describe('appendHistoryMessages()', () => {
    it('rewrites type:user to type:user_replay and passes others through', () => {
      const store = useSessionStore()
      store.appendHistoryMessages('sess-1', [
        { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } },
        { type: 'assistant', message: { role: 'assistant', content: [] } },
      ])

      const stored = store.messagesForSession('sess-1')
      expect(stored).toHaveLength(2)
      expect(stored[0]!.raw.type).toBe('user_replay')
      expect(stored[1]!.raw.type).toBe('assistant')
    })
  })

  /* ── send ──────────────────────────────────────────────────────── */

  describe('send()', () => {
    it('sends POST to the correct endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(undefined)
      vi.stubGlobal('$fetch', fetchMock)

      const store = useSessionStore()
      await store.send('sess-1', 'hello world')

      expect(fetchMock).toHaveBeenCalledWith('http://test:3101/sessions/sess-1/send', {
        method: 'POST',
        body: { message: 'hello world' },
      })
    })

    it('forwards optional model and effort', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(undefined)
      vi.stubGlobal('$fetch', fetchMock)

      const store = useSessionStore()
      await store.send('sess-1', 'hello', { model: 'opus', effort: 'high' })

      expect(fetchMock).toHaveBeenCalledWith('http://test:3101/sessions/sess-1/send', {
        method: 'POST',
        body: { message: 'hello', model: 'opus', effort: 'high' },
      })
    })
  })

  /* ── reply ─────────────────────────────────────────────────────── */

  describe('reply()', () => {
    it('sends POST with toolUseID and decision', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(undefined)
      vi.stubGlobal('$fetch', fetchMock)

      const store = useSessionStore()
      await store.reply('sess-1', 'tool-123', 'allow')

      expect(fetchMock).toHaveBeenCalledWith('http://test:3101/sessions/sess-1/reply', {
        method: 'POST',
        body: { toolUseID: 'tool-123', decision: 'allow' },
      })
    })
  })

  /* ── interrupt ─────────────────────────────────────────────────── */

  describe('interrupt()', () => {
    it('sends POST to the interrupt endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(undefined)
      vi.stubGlobal('$fetch', fetchMock)

      const store = useSessionStore()
      await store.interrupt('sess-1')

      expect(fetchMock).toHaveBeenCalledWith('http://test:3101/sessions/sess-1/interrupt', {
        method: 'POST',
      })
    })
  })

  /* ── destroy ────────────────────────────────────────────────────── */

  describe('destroy()', () => {
    it('calls DELETE and removes session from store', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({ status: 204, _data: null })
      vi.stubGlobal('$fetch', { raw: fetchMock })

      const store = useSessionStore()
      store.sessions.set('s1', makeSession({ id: 's1', repositoryId: 'r1' }))
      store.activeSessionByRepository.set('r1', 's1')

      const result = await store.destroy('s1')

      expect(result.blocked).toBe(false)
      expect(store.sessions.has('s1')).toBe(false)
    })

    it('returns blocked with reason when server returns 409', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        status: 409,
        _data: { error: 'has uncommitted changes', code: 'DIRTY_STATE' },
      })
      vi.stubGlobal('$fetch', { raw: fetchMock })

      const store = useSessionStore()
      store.sessions.set('s1', makeSession({ id: 's1', repositoryId: 'r1' }))

      const result = await store.destroy('s1')

      expect(result.blocked).toBe(true)
      if (result.blocked) {
        expect(result.reason).toContain('uncommitted changes')
      }
      // Session should still be in store
      expect(store.sessions.has('s1')).toBe(true)
    })

    it('sends DELETE with force=true query param when force option set', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({ status: 204, _data: null })
      vi.stubGlobal('$fetch', { raw: fetchMock })

      const store = useSessionStore()
      store.sessions.set('s1', makeSession({ id: 's1', repositoryId: 'r1' }))

      await store.destroy('s1', { force: true })

      expect(fetchMock).toHaveBeenCalledWith(
        'http://test:3101/sessions/s1?force=true',
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
  })

  /* ── removeSession ──────────────────────────────────────────────── */

  describe('removeSession()', () => {
    it('removes session and its messages from store', () => {
      const store = useSessionStore()
      store.sessions.set('s1', makeSession({ id: 's1', repositoryId: 'r1' }))
      store.appendMessage('s1', { type: 'text', text: 'hello' })
      store.activeSessionByRepository.set('r1', 's1')

      store.removeSession('s1', 'r1')

      expect(store.sessions.has('s1')).toBe(false)
      expect(store.messages.has('s1')).toBe(false)
      expect(store.activeSessionByRepository.get('r1')).toBeUndefined()
    })

    it('switches active session to next available when active is removed', () => {
      const store = useSessionStore()
      store.sessions.set('s1', makeSession({ id: 's1', repositoryId: 'r1' }))
      store.sessions.set('s2', makeSession({ id: 's2', repositoryId: 'r1' }))
      store.activeSessionByRepository.set('r1', 's1')

      store.removeSession('s1', 'r1')

      expect(store.activeSessionByRepository.get('r1')).toBe('s2')
    })

    it('removes active entry when no sessions remain', () => {
      const store = useSessionStore()
      store.sessions.set('s1', makeSession({ id: 's1', repositoryId: 'r1' }))
      store.activeSessionByRepository.set('r1', 's1')

      store.removeSession('s1', 'r1')

      expect(store.activeSessionByRepository.has('r1')).toBe(false)
    })
  })
})
