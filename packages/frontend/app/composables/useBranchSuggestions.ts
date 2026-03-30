import type { InputMenuItem } from '@nuxt/ui'

export function useBranchSuggestions(repositoryId: Ref<string>) {
  const config = useRuntimeConfig()
  const items = ref<InputMenuItem[]>([])
  const loading = ref(false)
  const headBranch = ref('')

  async function refresh() {
    if (!repositoryId.value) {
      items.value = []
      return
    }

    loading.value = true
    try {
      const data = await $fetch<{
        all: string[]
        current: string
      }>(`${config.public.backendUrl}/repositories/${repositoryId.value}/git/branches`)

      headBranch.value = data.current

      items.value = data.all.map(branch => ({
        label: branch,
        icon: 'i-lucide-git-branch',
        chip: branch === data.current
          ? { color: 'primary' as const, label: 'HEAD', size: 'xs' as const }
          : undefined,
      })) as InputMenuItem[]
    } catch {
      items.value = []
    } finally {
      loading.value = false
    }
  }

  watch(repositoryId, () => refresh(), { immediate: true })

  return { items, loading, refresh, headBranch }
}
