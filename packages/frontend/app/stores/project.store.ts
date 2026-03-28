import type { Project } from '~/types'

export const useProjectStore = defineStore('project', () => {
  const config = useRuntimeConfig()
  const project = ref<Project | null>(null)

  async function fetch() {
    try {
      project.value = await $fetch<Project>(`${config.public.backendUrl}/project`)
    } catch {
      project.value = null
    }
  }

  async function update(fields: { name?: string }) {
    project.value = await $fetch<Project>(`${config.public.backendUrl}/project`, {
      method: 'PATCH',
      body: fields,
    })
  }

  return { project, fetch, update }
})
