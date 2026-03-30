import { useDebounceFn } from '@vueuse/core'
import type { InputMenuItem } from '@nuxt/ui'

const STORAGE_KEY = 'oncraft:lastRepoParent'

export function usePathSuggestions(pathValue: Ref<string>) {
  const config = useRuntimeConfig()
  const items = ref<InputMenuItem[]>([])
  const loading = ref(false)
  const isGitRepo = ref(false)

  const lastParent = ref(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem(STORAGE_KEY) ?? ''
      : '',
  )

  const defaultRoot = ref('')

  // Fetch the configured root from backend
  async function fetchRoot() {
    try {
      const data = await $fetch<{ root: string }>(`${config.public.backendUrl}/filesystem/root`)
      defaultRoot.value = data.root
    } catch {
      // fallback: leave empty
    }
  }
  fetchRoot()

  let fetchController: AbortController | null = null

  /** Expand ~ to the configured root path */
  function expandTilde(p: string): string {
    if (defaultRoot.value && (p === '~' || p.startsWith('~/'))) {
      return p.replace(/^~/, defaultRoot.value)
    }
    return p
  }

  function getParentAndSegment(fullPath: string): { parent: string, segment: string } {
    if (!fullPath || fullPath === '/') return { parent: '/', segment: '' }
    if (fullPath.endsWith('/')) return { parent: fullPath.slice(0, -1) || '/', segment: '' }
    const lastSlash = fullPath.lastIndexOf('/')
    if (lastSlash === -1) return { parent: '/', segment: fullPath }
    return {
      parent: fullPath.slice(0, lastSlash) || '/',
      segment: fullPath.slice(lastSlash + 1),
    }
  }

  // Raw entries from last fetch — used to resolve selections
  const rawEntries = ref<Array<{ name: string, path: string, isGitRepo: boolean }>>([])

  const debouncedFetch = useDebounceFn(async (rawPath: string) => {
    const path = expandTilde(rawPath)
    const { parent, segment } = getParentAndSegment(path)
    if (!parent) {
      items.value = []
      return
    }

    // Don't fetch paths outside the configured root
    if (defaultRoot.value && parent !== defaultRoot.value && !parent.startsWith(`${defaultRoot.value}/`)) {
      matches.value = []
      items.value = []
      return
    }

    fetchController?.abort()
    fetchController = new AbortController()

    loading.value = true
    try {
      const data = await $fetch<{
        entries: Array<{ name: string, path: string, isGitRepo: boolean }>
        parent: string | null
        isGitRepo: boolean
      }>(`${config.public.backendUrl}/filesystem/list-dirs`, {
        query: { path: parent },
        signal: fetchController.signal,
      })

      rawEntries.value = data.entries

      const filtered = segment
        ? data.entries.filter(e => e.name.toLowerCase().startsWith(segment.toLowerCase()))
        : data.entries

      items.value = filtered.map(e => ({
        label: e.name,
        icon: e.isGitRepo ? 'i-simple-icons-git' : 'i-lucide-folder',
        value: e.path,
      })) as InputMenuItem[]

      // Git repo detection: response-level for listed dir, entry-level for partial paths
      if (path.endsWith('/')) {
        isGitRepo.value = data.isGitRepo
      } else {
        isGitRepo.value = data.entries.some(
          e => e.path === path && e.isGitRepo,
        )
      }
    } catch {
      items.value = []
      isGitRepo.value = false
    } finally {
      loading.value = false
    }
  }, 200)

  // Also keep filtered matches for Tab-completion
  const matches = computed(() => {
    return rawEntries.value
  })

  watch(pathValue, (val) => {
    if (val && typeof val === 'string') {
      rawEntries.value = []
      debouncedFetch(val)
    } else {
      items.value = []
      rawEntries.value = []
      isGitRepo.value = false
    }
  })

  function saveLastParent(repoPath: string) {
    const lastSlash = repoPath.lastIndexOf('/')
    const parent = lastSlash > 0 ? repoPath.slice(0, lastSlash) : '/'
    lastParent.value = parent
    localStorage.setItem(STORAGE_KEY, parent)
  }

  /** If val matches a known entry path, return it with trailing slash. Otherwise null. */
  function resolveSelection(val: string): string | null {
    const match = rawEntries.value.find(e => e.path === val)
    return match ? `${match.path}/` : null
  }

  return { items, loading, isGitRepo, lastParent, saveLastParent, resolveSelection, defaultRoot }
}
