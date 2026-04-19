import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'
import PromptToolbar from '~/components/prompt/PromptToolbar.vue'

// ── Store state shared across mock instances ──────────────────────────────
const mockCaps = {
  models: ref<any[]>([]),
  effortLevels: ref<any[]>([]),
  permissionModes: ref<any[]>([]),
  thinkingModes: ref<any[]>([]),
  defaultThinkingBudget: ref(8000),
  loaded: ref(false),
  load: vi.fn().mockResolvedValue(undefined),
}

const mockSessionsMap = ref(new Map<string, any>())
const mockUpdatePreferences = vi.fn().mockResolvedValue(undefined)

mockNuxtImport('useCapabilitiesStore', () => () => ({
  get models() { return mockCaps.models.value },
  set models(v: any[]) { mockCaps.models.value = v },
  get effortLevels() { return mockCaps.effortLevels.value },
  set effortLevels(v: any[]) { mockCaps.effortLevels.value = v },
  get permissionModes() { return mockCaps.permissionModes.value },
  set permissionModes(v: any[]) { mockCaps.permissionModes.value = v },
  get thinkingModes() { return mockCaps.thinkingModes.value },
  set thinkingModes(v: any[]) { mockCaps.thinkingModes.value = v },
  get defaultThinkingBudget() { return mockCaps.defaultThinkingBudget.value },
  set defaultThinkingBudget(v: number) { mockCaps.defaultThinkingBudget.value = v },
  get loaded() { return mockCaps.loaded.value },
  set loaded(v: boolean) { mockCaps.loaded.value = v },
  load: mockCaps.load,
}))

mockNuxtImport('useSessionStore', () => () => ({
  get sessions() { return mockSessionsMap.value },
  updatePreferences: mockUpdatePreferences,
}))

// ── Helpers ───────────────────────────────────────────────────────────────

function seedCaps() {
  mockCaps.models.value = [
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'opus', label: 'Opus' },
  ]
  mockCaps.effortLevels.value = [
    { value: 'low', label: 'Low' },
    { value: 'xhigh', label: 'X-High', supportedModels: ['opus'] },
  ]
  mockCaps.permissionModes.value = [
    { value: 'default', label: 'Ask' },
    { value: 'bypassPermissions', label: 'Bypass', dangerous: true },
  ]
  mockCaps.thinkingModes.value = [
    { value: 'off', label: 'Off' },
    { value: 'adaptive', label: 'Adaptive' },
    { value: 'fixed', label: 'Fixed' },
  ]
  mockCaps.defaultThinkingBudget.value = 8000
  mockCaps.loaded.value = true
}

function seedSession(overrides: Record<string, unknown> = {}) {
  mockSessionsMap.value.set('s1', {
    id: 's1', repositoryId: 'r', claudeSessionId: null, name: 's',
    sourceBranch: 'main', workBranch: null, targetBranch: 'main',
    worktreePath: null, state: 'idle',
    createdAt: '', lastActivityAt: '', costUsd: 0, inputTokens: 0, outputTokens: 0,
    preferredModel: null, preferredEffort: null, preferredPermissionMode: null,
    thinkingMode: null, thinkingBudget: null,
    ...overrides,
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('PromptToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSessionsMap.value = new Map()
    mockCaps.models.value = []
    mockCaps.effortLevels.value = []
    mockCaps.permissionModes.value = []
    mockCaps.thinkingModes.value = []
    mockCaps.loaded.value = false
    mockUpdatePreferences.mockResolvedValue(undefined)
  })

  it('hydrates initial values from the session preferences', async () => {
    seedCaps()
    seedSession({ preferredModel: 'opus', preferredEffort: 'xhigh', thinkingMode: 'fixed', thinkingBudget: 9000 })
    const wrapper = await mountSuspended(PromptToolbar, { props: { sessionId: 's1' } })
    expect(wrapper.vm.model).toBe('opus')
    expect(wrapper.vm.effort).toBe('xhigh')
    expect(wrapper.vm.thinkingMode).toBe('fixed')
    expect(wrapper.vm.thinkingBudget).toBe(9000)
  })

  it('calls sessionStore.updatePreferences on model change', async () => {
    vi.useFakeTimers()
    seedCaps(); seedSession()
    const wrapper = await mountSuspended(PromptToolbar, { props: { sessionId: 's1' } })
    await wrapper.vm.setModel('opus')
    await vi.runAllTimersAsync()
    vi.useRealTimers()
    expect(mockUpdatePreferences).toHaveBeenCalledWith('s1', expect.objectContaining({ preferredModel: 'opus' }))
  })

  it('disables effort options whose supportedModels excludes the current model', async () => {
    seedCaps(); seedSession({ preferredModel: 'sonnet' })
    const wrapper = await mountSuspended(PromptToolbar, { props: { sessionId: 's1' } })
    const disabled = wrapper.vm.effortItems.find((i: any) => i.value === 'xhigh')
    expect(disabled.disabled).toBe(true)
  })

  it('shows budget input only when thinkingMode is fixed', async () => {
    seedCaps(); seedSession({ thinkingMode: 'off' })
    const wrapper = await mountSuspended(PromptToolbar, { props: { sessionId: 's1' } })
    expect(wrapper.find('[data-test="thinking-budget"]').exists()).toBe(false)
    await wrapper.vm.setThinkingMode('fixed')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="thinking-budget"]').exists()).toBe(true)
  })

  it('threads dangerous: true through permission items for slot-based styling', async () => {
    seedCaps(); seedSession()
    const wrapper = await mountSuspended(PromptToolbar, { props: { sessionId: 's1' } })
    const bypass = wrapper.vm.permissionItems.find((i: any) => i.value === 'bypassPermissions')
    expect(bypass.dangerous).toBe(true)
    const normal = wrapper.vm.permissionItems.find((i: any) => i.value === 'default')
    expect(normal.dangerous).toBeFalsy()
  })

  it('clears the pending debounce timer on unmount', async () => {
    seedCaps(); seedSession()
    // Mount while real timers are active so mountSuspended can resolve
    const wrapper = await mountSuspended(PromptToolbar, { props: { sessionId: 's1' } })
    // Switch to fake timers AFTER mount so setTimeout inside the component is intercepted
    vi.useFakeTimers()
    try {
      await wrapper.vm.setModel('opus')
      wrapper.unmount()
      vi.advanceTimersByTime(2000)
      // PATCH should NOT have been called because timer was cleared on unmount
      expect(mockUpdatePreferences).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
