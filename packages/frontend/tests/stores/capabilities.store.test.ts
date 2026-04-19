import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCapabilitiesStore } from '~/stores/capabilities.store'

describe('capabilities store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('fetches and caches /sdk/capabilities', async () => {
    const payload = {
      models: [{ value: 'opus', label: 'Opus' }],
      effortLevels: [{ value: 'high', label: 'High' }],
      permissionModes: [{ value: 'default', label: 'Ask' }],
      thinkingModes: [{ value: 'off', label: 'Off' }],
      defaultThinkingBudget: 8000,
    }
    const fetchSpy = vi.fn().mockResolvedValue(payload)
    vi.stubGlobal('$fetch', fetchSpy)

    const store = useCapabilitiesStore()
    await store.load()

    expect(store.models).toEqual(payload.models)
    expect(store.defaultThinkingBudget).toBe(8000)

    // Second call must not re-fetch (loaded flag caches the result)
    await store.load()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('fetches from the correct endpoint', async () => {
    const payload = {
      models: [],
      effortLevels: [],
      permissionModes: [],
      thinkingModes: [],
      defaultThinkingBudget: 8000,
    }
    const fetchSpy = vi.fn().mockResolvedValue(payload)
    vi.stubGlobal('$fetch', fetchSpy)

    const store = useCapabilitiesStore()
    await store.load()

    expect(fetchSpy).toHaveBeenCalledWith('http://test:3101/sdk/capabilities')
  })
})
