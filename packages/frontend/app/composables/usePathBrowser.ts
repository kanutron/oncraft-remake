import { useDebounceFn } from '@vueuse/core'

const STORAGE_KEY = 'oncraft:lastRepoParent'

interface DirEntry {
  name: string
  path: string
  isGitRepo: boolean
}

interface ListDirsResponse {
  entries: DirEntry[]
  parent: string | null
  isGitRepo: boolean
}

export interface PathTreeNode {
  label: string
  icon: string
  path: string
  isGitRepo: boolean
  children?: PathTreeNode[]
}

export function usePathBrowser() {
  const config = useRuntimeConfig()
  const defaultRoot = ref('')
  const isGitRepo = ref(false)

  const lastParent = ref(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem(STORAGE_KEY) ?? ''
      : '',
  )

  async function fetchDefaultRoot() {
    try {
      const data = await $fetch<{ root: string }>(`${config.public.backendUrl}/filesystem/root`)
      defaultRoot.value = data.root
    } catch {}
  }
  fetchDefaultRoot()

  async function listDir(path: string): Promise<ListDirsResponse> {
    return $fetch<ListDirsResponse>(`${config.public.backendUrl}/filesystem/list-dirs`, {
      query: { path },
    })
  }

  function entriesToTreeNodes(entries: DirEntry[]): PathTreeNode[] {
    return entries.map((e) => {
      if (e.isGitRepo) {
        return {
          label: e.name,
          icon: 'i-simple-icons-git',
          path: e.path,
          isGitRepo: true,
        }
      }
      return {
        label: e.name,
        icon: 'i-lucide-folder',
        path: e.path,
        isGitRepo: false,
        // Placeholder child so UTree renders the expand chevron
        children: [{ label: 'Loading...', icon: 'i-lucide-loader-circle', path: `${e.path}/__loading`, isGitRepo: false }],
      }
    })
  }

  function expandTilde(p: string): string {
    if (defaultRoot.value && (p === '~' || p.startsWith('~/'))) {
      return p.replace(/^~/, defaultRoot.value)
    }
    return p
  }

  const checkGitRepo = useDebounceFn(async (rawPath: string) => {
    if (!rawPath || rawPath.length < 2) {
      isGitRepo.value = false
      return
    }
    const path = expandTilde(rawPath)
    const normalized = path.endsWith('/') ? path.slice(0, -1) : path
    if (!normalized) {
      isGitRepo.value = false
      return
    }
    try {
      const data = await listDir(normalized)
      isGitRepo.value = data.isGitRepo
    } catch {
      isGitRepo.value = false
    }
  }, 300)

  function saveLastParent(repoPath: string) {
    const lastSlash = repoPath.lastIndexOf('/')
    const parent = lastSlash > 0 ? repoPath.slice(0, lastSlash) : '/'
    lastParent.value = parent
    localStorage.setItem(STORAGE_KEY, parent)
  }

  return {
    defaultRoot,
    lastParent,
    isGitRepo,
    listDir,
    entriesToTreeNodes,
    expandTilde,
    checkGitRepo,
    saveLastParent,
  }
}
