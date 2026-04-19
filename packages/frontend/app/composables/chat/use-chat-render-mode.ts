import type { Ref } from 'vue'
import type { RenderMode } from '~/types/chat'

interface UseRenderModeOptions {
  sticky?: boolean
}

interface UseRenderModeApi {
  mode: Ref<RenderMode>
  setMode: (mode: RenderMode) => void
  cycleMode: (modes?: RenderMode[]) => void
  reset: () => void
}

const DEFAULT_CYCLE: readonly RenderMode[] = ['badge', 'compact', 'full']

// Module-scoped singletons so the same componentKey shares state across call sites.
const overrides = reactive<Map<string, RenderMode>>(new Map())

function useRenderMode(
  componentKey: string,
  defaultMode: RenderMode,
  options: UseRenderModeOptions = {},
): UseRenderModeApi {
  const mode = computed<RenderMode>(() => {
    const override = overrides.get(componentKey)
    if (override) return override
    if (options.sticky) return 'compact'
    return defaultMode
  })

  function setMode(newMode: RenderMode) {
    overrides.set(componentKey, newMode)
  }

  function cycleMode(modes: readonly RenderMode[] = DEFAULT_CYCLE) {
    const current = mode.value
    const idx = modes.indexOf(current)
    const next = idx === -1 ? modes[0] : modes[(idx + 1) % modes.length]
    overrides.set(componentKey, next)
  }

  function reset() {
    overrides.delete(componentKey)
  }

  return {
    mode: mode as unknown as Ref<RenderMode>,
    setMode,
    cycleMode,
    reset,
  }
}

function resetAll() {
  overrides.clear()
}

export function useChatRenderMode() {
  return { useRenderMode, resetAll }
}
