import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Workspace } from '~/types'

// Import the store — auto-imports are polyfilled by tests/setup.ts
import { useWorkspaceStore } from '~/stores/workspace.store'

/* ── Helpers ──────────────────────────────────────────────────────── */

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    path: '/tmp/project',
    name: 'project',
    createdAt: '2025-01-01T00:00:00Z',
    lastOpenedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe('useWorkspaceStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  /* ── fetchAll ──────────────────────────────────────────────────── */

  describe('fetchAll()', () => {
    it('populates the workspaces map from the API', async () => {
      const ws1 = makeWorkspace({ id: 'ws-1', name: 'alpha' })
      const ws2 = makeWorkspace({ id: 'ws-2', name: 'beta' })

      vi.stubGlobal('$fetch', vi.fn().mockResolvedValueOnce([ws1, ws2]))

      const store = useWorkspaceStore()
      await store.fetchAll()

      expect(store.workspaces.size).toBe(2)
      expect(store.workspaces.get('ws-1')).toEqual(ws1)
      expect(store.workspaces.get('ws-2')).toEqual(ws2)
    })

    it('calls the correct endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce([])
      vi.stubGlobal('$fetch', fetchMock)

      const store = useWorkspaceStore()
      await store.fetchAll()

      expect(fetchMock).toHaveBeenCalledWith('http://test:3001/workspaces')
    })

    it('replaces existing workspaces on re-fetch', async () => {
      const ws1 = makeWorkspace({ id: 'ws-1' })
      const ws2 = makeWorkspace({ id: 'ws-2' })

      const fetchMock = vi.fn()
        .mockResolvedValueOnce([ws1, ws2])
        .mockResolvedValueOnce([ws2])

      vi.stubGlobal('$fetch', fetchMock)

      const store = useWorkspaceStore()
      await store.fetchAll()
      expect(store.workspaces.size).toBe(2)

      await store.fetchAll()
      expect(store.workspaces.size).toBe(1)
      expect(store.workspaces.has('ws-1')).toBe(false)
    })
  })

  /* ── open ──────────────────────────────────────────────────────── */

  describe('open()', () => {
    it('adds a workspace and sets it active', async () => {
      const ws = makeWorkspace({ id: 'ws-new' })
      vi.stubGlobal('$fetch', vi.fn().mockResolvedValueOnce(ws))

      const store = useWorkspaceStore()
      const result = await store.open('/tmp/project', 'project')

      expect(result).toEqual(ws)
      expect(store.workspaces.get('ws-new')).toEqual(ws)
      expect(store.activeWorkspaceId).toBe('ws-new')
    })

    it('sends POST to the correct endpoint with body', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(makeWorkspace())
      vi.stubGlobal('$fetch', fetchMock)

      const store = useWorkspaceStore()
      await store.open('/path/to/repo', 'my-repo')

      expect(fetchMock).toHaveBeenCalledWith('http://test:3001/workspaces', {
        method: 'POST',
        body: { path: '/path/to/repo', name: 'my-repo' },
      })
    })

    it('name is optional', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(makeWorkspace())
      vi.stubGlobal('$fetch', fetchMock)

      const store = useWorkspaceStore()
      await store.open('/path/to/repo')

      expect(fetchMock).toHaveBeenCalledWith('http://test:3001/workspaces', {
        method: 'POST',
        body: { path: '/path/to/repo', name: undefined },
      })
    })
  })

  /* ── close ─────────────────────────────────────────────────────── */

  describe('close()', () => {
    it('removes the workspace from the map', async () => {
      const ws = makeWorkspace({ id: 'ws-1' })
      vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(undefined))

      const store = useWorkspaceStore()
      store.workspaces.set('ws-1', ws)

      await store.close('ws-1')
      expect(store.workspaces.has('ws-1')).toBe(false)
    })

    it('sends DELETE to the correct endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('$fetch', fetchMock)

      const store = useWorkspaceStore()
      store.workspaces.set('ws-1', makeWorkspace({ id: 'ws-1' }))

      await store.close('ws-1')

      expect(fetchMock).toHaveBeenCalledWith('http://test:3001/workspaces/ws-1', {
        method: 'DELETE',
      })
    })

    it('selects the next workspace when the active one is closed', async () => {
      vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(undefined))

      const store = useWorkspaceStore()
      const ws1 = makeWorkspace({ id: 'ws-1', lastOpenedAt: '2025-01-01T00:00:00Z' })
      const ws2 = makeWorkspace({ id: 'ws-2', lastOpenedAt: '2025-06-01T00:00:00Z' })
      store.workspaces.set('ws-1', ws1)
      store.workspaces.set('ws-2', ws2)
      store.activeWorkspaceId = 'ws-1'

      await store.close('ws-1')

      expect(store.activeWorkspaceId).toBe('ws-2')
    })

    it('sets activeWorkspaceId to null when last workspace is closed', async () => {
      vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(undefined))

      const store = useWorkspaceStore()
      store.workspaces.set('ws-1', makeWorkspace({ id: 'ws-1' }))
      store.activeWorkspaceId = 'ws-1'

      await store.close('ws-1')

      expect(store.activeWorkspaceId).toBeNull()
    })

    it('does not change activeWorkspaceId when a non-active workspace is closed', async () => {
      vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(undefined))

      const store = useWorkspaceStore()
      store.workspaces.set('ws-1', makeWorkspace({ id: 'ws-1' }))
      store.workspaces.set('ws-2', makeWorkspace({ id: 'ws-2' }))
      store.activeWorkspaceId = 'ws-1'

      await store.close('ws-2')

      expect(store.activeWorkspaceId).toBe('ws-1')
    })
  })

  /* ── setActive ─────────────────────────────────────────────────── */

  describe('setActive()', () => {
    it('updates activeWorkspaceId', () => {
      const store = useWorkspaceStore()
      store.setActive('ws-42')
      expect(store.activeWorkspaceId).toBe('ws-42')
    })
  })

  /* ── activeWorkspace (computed) ────────────────────────────────── */

  describe('activeWorkspace', () => {
    it('returns the active workspace object', () => {
      const store = useWorkspaceStore()
      const ws = makeWorkspace({ id: 'ws-1' })
      store.workspaces.set('ws-1', ws)
      store.activeWorkspaceId = 'ws-1'

      expect(store.activeWorkspace).toEqual(ws)
    })

    it('returns null when no workspace is active', () => {
      const store = useWorkspaceStore()
      expect(store.activeWorkspace).toBeNull()
    })

    it('returns null when activeWorkspaceId points to a missing workspace', () => {
      const store = useWorkspaceStore()
      store.activeWorkspaceId = 'nonexistent'
      expect(store.activeWorkspace).toBeNull()
    })
  })

  /* ── sortedWorkspaces (computed) ───────────────────────────────── */

  describe('sortedWorkspaces', () => {
    it('sorts workspaces by lastOpenedAt descending (most recent first)', () => {
      const store = useWorkspaceStore()
      const old = makeWorkspace({ id: 'ws-old', lastOpenedAt: '2024-01-01T00:00:00Z' })
      const mid = makeWorkspace({ id: 'ws-mid', lastOpenedAt: '2025-01-01T00:00:00Z' })
      const recent = makeWorkspace({ id: 'ws-recent', lastOpenedAt: '2025-06-01T00:00:00Z' })

      store.workspaces.set('ws-old', old)
      store.workspaces.set('ws-mid', mid)
      store.workspaces.set('ws-recent', recent)

      const sorted = store.sortedWorkspaces
      expect(sorted.map(w => w.id)).toEqual(['ws-recent', 'ws-mid', 'ws-old'])
    })

    it('returns empty array when there are no workspaces', () => {
      const store = useWorkspaceStore()
      expect(store.sortedWorkspaces).toEqual([])
    })
  })
})
