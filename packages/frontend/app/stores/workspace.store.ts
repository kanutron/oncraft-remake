import type { Workspace } from '~/types'

export const useWorkspaceStore = defineStore('workspace', () => {
  const config = useRuntimeConfig()
  const workspaces = ref<Map<string, Workspace>>(new Map())
  const activeWorkspaceId = ref<string | null>(null)

  const activeWorkspace = computed(() =>
    activeWorkspaceId.value ? workspaces.value.get(activeWorkspaceId.value) ?? null : null
  )

  const sortedWorkspaces = computed(() =>
    Array.from(workspaces.value.values()).sort((a, b) =>
      new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime()
    )
  )

  async function fetchAll() {
    const data = await $fetch<Workspace[]>(`${config.public.backendUrl}/workspaces`)
    workspaces.value = new Map(data.map(ws => [ws.id, ws]))
  }

  async function open(path: string, name?: string) {
    const ws = await $fetch<Workspace>(`${config.public.backendUrl}/workspaces`, {
      method: 'POST',
      body: { path, name },
    })
    workspaces.value.set(ws.id, ws)
    activeWorkspaceId.value = ws.id
    return ws
  }

  async function close(id: string) {
    await $fetch(`${config.public.backendUrl}/workspaces/${id}`, { method: 'DELETE' })
    workspaces.value.delete(id)
    if (activeWorkspaceId.value === id) {
      activeWorkspaceId.value = sortedWorkspaces.value[0]?.id ?? null
    }
  }

  function setActive(id: string) {
    activeWorkspaceId.value = id
  }

  return { workspaces, activeWorkspaceId, activeWorkspace, sortedWorkspaces, fetchAll, open, close, setActive }
})
