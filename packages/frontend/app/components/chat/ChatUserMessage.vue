<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  sticky?: boolean
  data: { type: 'user'; message?: { content?: unknown }; content?: unknown }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode } = useRenderMode(props.componentKey, props.defaultMode, { sticky: props.sticky })

const text = computed(() => {
  const raw = props.data?.message?.content ?? props.data?.content
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    return raw
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
  }
  return String(raw ?? '')
})
</script>

<template>
  <div :data-mode="mode" class="block my-2">
    <UChatMessage
      :id="componentKey"
      role="user"
      side="right"
      variant="soft"
      icon="i-lucide-user"
      :parts="[]"
    >
      <template #content>
        <p class="whitespace-pre-wrap">{{ text }}</p>
      </template>
    </UChatMessage>
  </div>
</template>
