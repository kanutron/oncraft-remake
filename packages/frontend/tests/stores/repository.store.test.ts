import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Repository } from '~/types'

// Import the store — auto-imports are polyfilled by tests/setup.ts
import { useRepositoryStore } from '~/stores/repository.store'

/* ── Helpers ──────────────────────────────────────────────────────── */

function makeRepository(overrides: Partial<Repository> = {}): Repository {
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

describe('useRepositoryStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  /* ── fetchAll ──────────────────────────────────────────────────── */

  describe('fetchAll()', () => {
    it('populates the repositories map from the API', async () => {
      const repo1 = makeRepository({ id: 'ws-1', name: 'alpha' })
      const repo2 = makeRepository({ id: 'ws-2', name: 'beta' })

      vi.stubGlobal('$fetch', vi.fn().mockResolvedValueOnce([repo1, repo2]))

      const store = useRepositoryStore()
      await store.fetchAll()

      expect(store.repositories.size).toBe(2)
      expect(store.repositories.get('ws-1')).toEqual(repo1)
      expect(store.repositories.get('ws-2')).toEqual(repo2)
    })

    it('calls the correct endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce([])
      vi.stubGlobal('$fetch', fetchMock)

      const store = useRepositoryStore()
      await store.fetchAll()

      expect(fetchMock).toHaveBeenCalledWith('http://test:3001/repositories')
    })

    it('replaces existing repositories on re-fetch', async () => {
      const repo1 = makeRepository({ id: 'ws-1' })
      const repo2 = makeRepository({ id: 'ws-2' })

      const fetchMock = vi.fn()
        .mockResolvedValueOnce([repo1, repo2])
        .mockResolvedValueOnce([repo2])

      vi.stubGlobal('$fetch', fetchMock)

      const store = useRepositoryStore()
      await store.fetchAll()
      expect(store.repositories.size).toBe(2)

      await store.fetchAll()
      expect(store.repositories.size).toBe(1)
      expect(store.repositories.has('ws-1')).toBe(false)
    })
  })

  /* ── open ──────────────────────────────────────────────────────── */

  describe('open()', () => {
    it('adds a repository and sets it active', async () => {
      const repo = makeRepository({ id: 'ws-new' })
      vi.stubGlobal('$fetch', vi.fn().mockResolvedValueOnce(repo))

      const store = useRepositoryStore()
      const result = await store.open('/tmp/project', 'project')

      expect(result).toEqual(repo)
      expect(store.repositories.get('ws-new')).toEqual(repo)
      expect(store.activeRepositoryId).toBe('ws-new')
    })

    it('sends POST to the correct endpoint with body', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(makeRepository())
      vi.stubGlobal('$fetch', fetchMock)

      const store = useRepositoryStore()
      await store.open('/path/to/repo', 'my-repo')

      expect(fetchMock).toHaveBeenCalledWith('http://test:3001/repositories', {
        method: 'POST',
        body: { path: '/path/to/repo', name: 'my-repo' },
      })
    })

    it('name is optional', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(makeRepository())
      vi.stubGlobal('$fetch', fetchMock)

      const store = useRepositoryStore()
      await store.open('/path/to/repo')

      expect(fetchMock).toHaveBeenCalledWith('http://test:3001/repositories', {
        method: 'POST',
        body: { path: '/path/to/repo', name: undefined },
      })
    })
  })

  /* ── close ─────────────────────────────────────────────────────── */

  describe('close()', () => {
    it('removes the repository from the map', async () => {
      const repo = makeRepository({ id: 'ws-1' })
      vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(undefined))

      const store = useRepositoryStore()
      store.repositories.set('ws-1', repo)

      await store.close('ws-1')
      expect(store.repositories.has('ws-1')).toBe(false)
    })

    it('sends DELETE to the correct endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('$fetch', fetchMock)

      const store = useRepositoryStore()
      store.repositories.set('ws-1', makeRepository({ id: 'ws-1' }))

      await store.close('ws-1')

      expect(fetchMock).toHaveBeenCalledWith('http://test:3001/repositories/ws-1', {
        method: 'DELETE',
      })
    })

    it('selects the next repository when the active one is closed', async () => {
      vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(undefined))

      const store = useRepositoryStore()
      const repo1 = makeRepository({ id: 'ws-1', lastOpenedAt: '2025-01-01T00:00:00Z' })
      const repo2 = makeRepository({ id: 'ws-2', lastOpenedAt: '2025-06-01T00:00:00Z' })
      store.repositories.set('ws-1', repo1)
      store.repositories.set('ws-2', repo2)
      store.activeRepositoryId = 'ws-1'

      await store.close('ws-1')

      expect(store.activeRepositoryId).toBe('ws-2')
    })

    it('sets activeRepositoryId to null when last repository is closed', async () => {
      vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(undefined))

      const store = useRepositoryStore()
      store.repositories.set('ws-1', makeRepository({ id: 'ws-1' }))
      store.activeRepositoryId = 'ws-1'

      await store.close('ws-1')

      expect(store.activeRepositoryId).toBeNull()
    })

    it('does not change activeRepositoryId when a non-active repository is closed', async () => {
      vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(undefined))

      const store = useRepositoryStore()
      store.repositories.set('ws-1', makeRepository({ id: 'ws-1' }))
      store.repositories.set('ws-2', makeRepository({ id: 'ws-2' }))
      store.activeRepositoryId = 'ws-1'

      await store.close('ws-2')

      expect(store.activeRepositoryId).toBe('ws-1')
    })
  })

  /* ── setActive ─────────────────────────────────────────────────── */

  describe('setActive()', () => {
    it('updates activeRepositoryId', () => {
      const store = useRepositoryStore()
      store.setActive('ws-42')
      expect(store.activeRepositoryId).toBe('ws-42')
    })
  })

  /* ── activeRepository (computed) ──────────────────────────────── */

  describe('activeRepository', () => {
    it('returns the active repository object', () => {
      const store = useRepositoryStore()
      const repo = makeRepository({ id: 'ws-1' })
      store.repositories.set('ws-1', repo)
      store.activeRepositoryId = 'ws-1'

      expect(store.activeRepository).toEqual(repo)
    })

    it('returns null when no repository is active', () => {
      const store = useRepositoryStore()
      expect(store.activeRepository).toBeNull()
    })

    it('returns null when activeRepositoryId points to a missing repository', () => {
      const store = useRepositoryStore()
      store.activeRepositoryId = 'nonexistent'
      expect(store.activeRepository).toBeNull()
    })
  })

  /* ── sortedRepositories (computed) ────────────────────────────── */

  describe('sortedRepositories', () => {
    it('sorts repositories by lastOpenedAt descending (most recent first)', () => {
      const store = useRepositoryStore()
      const old = makeRepository({ id: 'ws-old', lastOpenedAt: '2024-01-01T00:00:00Z' })
      const mid = makeRepository({ id: 'ws-mid', lastOpenedAt: '2025-01-01T00:00:00Z' })
      const recent = makeRepository({ id: 'ws-recent', lastOpenedAt: '2025-06-01T00:00:00Z' })

      store.repositories.set('ws-old', old)
      store.repositories.set('ws-mid', mid)
      store.repositories.set('ws-recent', recent)

      const sorted = store.sortedRepositories
      expect(sorted.map(w => w.id)).toEqual(['ws-recent', 'ws-mid', 'ws-old'])
    })

    it('returns empty array when there are no repositories', () => {
      const store = useRepositoryStore()
      expect(store.sortedRepositories).toEqual([])
    })
  })
})
