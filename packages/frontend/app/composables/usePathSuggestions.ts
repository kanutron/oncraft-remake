import { useDebounceFn } from '@vueuse/core'

const STORAGE_KEY = 'oncraft:lastRepoParent'

interface DirEntry {
  name: string
  path: string
  isGitRepo: boolean
}

export function usePathSuggestions(userInput: Ref<string>) {
  const config = useRuntimeConfig()
  const loading = ref(false)
  const isGitRepo = ref(false)
  const defaultRoot = ref('')

  const lastParent = ref(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem(STORAGE_KEY) ?? ''
      : '',
  )

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

  // Current filtered matches from the last fetch
  const matches = ref<DirEntry[]>([])
  const firstMatch = computed(() => matches.value.length > 0 ? matches.value[0] : null)

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

  const debouncedFetch = useDebounceFn(async (path: string) => {
    const { parent, segment } = getParentAndSegment(path)
    if (!parent) {
      matches.value = []
      return
    }

    // Don't fetch paths that are clearly outside the configured root
    if (defaultRoot.value && !parent.startsWith(defaultRoot.value) && parent !== '/') {
      matches.value = []
      return
    }

    fetchController?.abort()
    fetchController = new AbortController()

    loading.value = true
    try {
      const data = await $fetch<{
        entries: DirEntry[]
        parent: string | null
        isGitRepo: boolean
      }>(`${config.public.backendUrl}/filesystem/list-dirs`, {
        query: { path: parent },
        signal: fetchController.signal,
      })

      matches.value = segment
        ? data.entries.filter(e => e.name.toLowerCase().startsWith(segment.toLowerCase()))
        : data.entries

      // Git repo detection
      if (path.endsWith('/')) {
        isGitRepo.value = data.isGitRepo
      } else {
        // Check if any matched entry IS the typed path and is a git repo
        const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path
        isGitRepo.value = data.entries.some(
          e => e.path === normalizedPath && e.isGitRepo,
        )
      }
    } catch {
      matches.value = []
      isGitRepo.value = false
    } finally {
      loading.value = false
    }
  }, 150)

  watch(userInput, (val) => {
    if (val && typeof val === 'string') {
      debouncedFetch(val)
    } else {
      matches.value = []
      isGitRepo.value = false
    }
  })

  function saveLastParent(repoPath: string) {
    const lastSlash = repoPath.lastIndexOf('/')
    const parent = lastSlash > 0 ? repoPath.slice(0, lastSlash) : '/'
    lastParent.value = parent
    localStorage.setItem(STORAGE_KEY, parent)
  }

  return { matches, firstMatch, loading, isGitRepo, lastParent, saveLastParent, defaultRoot }
}
