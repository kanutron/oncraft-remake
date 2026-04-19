import type { Ref } from 'vue'
import type { RenderMode } from '~/types/chat'

interface UseRenderModeOptions {
  sticky?: boolean
}

interface UseRenderModeApi {
  mode: Ref<RenderMode>
  setMode: (mode: RenderMode) => void
  reset: () => void
}

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

  function reset() {
    overrides.delete(componentKey)
  }

  return { mode: mode as unknown as Ref<RenderMode>, setMode, reset }
}

function resetAll() {
  overrides.clear()
}

export function useChatRenderMode() {
  return { useRenderMode, resetAll }
}
