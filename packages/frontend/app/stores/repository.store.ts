import type { Repository } from '~/types'

export const useRepositoryStore = defineStore('repository', () => {
  const config = useRuntimeConfig()
  const repositories = ref<Map<string, Repository>>(new Map())
  const activeRepositoryId = ref<string | null>(null)

  const activeRepository = computed(() =>
    activeRepositoryId.value ? repositories.value.get(activeRepositoryId.value) ?? null : null
  )

  const sortedRepositories = computed(() =>
    Array.from(repositories.value.values()).sort((a, b) =>
      new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime()
    )
  )

  async function fetchAll() {
    const data = await $fetch<Repository[]>(`${config.public.backendUrl}/repositories`)
    repositories.value = new Map(data.map(r => [r.id, r]))
    if (!activeRepositoryId.value && data.length > 0) {
      const sorted = [...data].sort((a, b) =>
        new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime()
      )
      activeRepositoryId.value = sorted[0].id
    }
  }

  async function open(path: string, name?: string) {
    const repo = await $fetch<Repository>(`${config.public.backendUrl}/repositories`, {
      method: 'POST',
      body: { path, name },
    })
    repositories.value.set(repo.id, repo)
    activeRepositoryId.value = repo.id
    return repo
  }

  async function close(id: string) {
    await $fetch(`${config.public.backendUrl}/repositories/${id}`, { method: 'DELETE' })
    repositories.value.delete(id)
    if (activeRepositoryId.value === id) {
      activeRepositoryId.value = sortedRepositories.value[0]?.id ?? null
    }
  }

  function setActive(id: string) {
    activeRepositoryId.value = id
  }

  return { repositories, activeRepositoryId, activeRepository, sortedRepositories, fetchAll, open, close, setActive }
})
