export interface CapabilityOption<V extends string = string> {
  value: V
  label: string
  supportedModels?: readonly string[]
  dangerous?: boolean
}

interface CapabilitiesPayload {
  models: CapabilityOption[]
  effortLevels: CapabilityOption[]
  permissionModes: CapabilityOption[]
  thinkingModes: CapabilityOption<'off' | 'adaptive' | 'fixed'>[]
  defaultThinkingBudget: number
}

export const useCapabilitiesStore = defineStore('capabilities', () => {
  const config = useRuntimeConfig()
  const loaded = ref(false)
  const models = ref<CapabilityOption[]>([])
  const effortLevels = ref<CapabilityOption[]>([])
  const permissionModes = ref<CapabilityOption[]>([])
  const thinkingModes = ref<CapabilityOption<'off' | 'adaptive' | 'fixed'>[]>([])
  const defaultThinkingBudget = ref(8000)

  async function load() {
    if (loaded.value) return
    const data = await $fetch<CapabilitiesPayload>(
      `${config.public.backendUrl}/sdk/capabilities`,
    )
    models.value = data.models
    effortLevels.value = data.effortLevels
    permissionModes.value = data.permissionModes
    thinkingModes.value = data.thinkingModes
    defaultThinkingBudget.value = data.defaultThinkingBudget
    loaded.value = true
  }

  return { loaded, models, effortLevels, permissionModes, thinkingModes, defaultThinkingBudget, load }
})
