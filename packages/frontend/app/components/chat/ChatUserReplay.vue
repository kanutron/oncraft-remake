<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'user_replay'; message?: { content?: unknown } }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode } = useRenderMode(props.componentKey, props.defaultMode)

const text = computed(() => {
  const c = props.data.message?.content
  return typeof c === 'string' ? c : JSON.stringify(c)
})
</script>

<template>
  <div :data-mode="mode" class="block my-2 opacity-70">
    <div class="flex items-center gap-1 text-xs text-neutral-500 mb-1">
      <UIcon name="i-lucide-history" class="size-3" /> Replay
    </div>
    <UChatMessage role="user" :id="componentKey" side="right" variant="soft" :parts="[{ type: 'text', id: componentKey, text }]" />
  </div>
</template>
