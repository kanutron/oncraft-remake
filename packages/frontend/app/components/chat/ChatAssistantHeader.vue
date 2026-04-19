<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { messageId: string; model?: string; usage?: { input_tokens?: number; output_tokens?: number } }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, cycleMode } = useRenderMode(props.componentKey, props.defaultMode)
</script>

<template>
  <div :data-mode="mode" class="block">
    <div
      v-if="mode !== 'badge'"
      class="flex items-center gap-2 text-xs text-neutral-500 mt-3 mb-1 cursor-pointer"
      @click="cycleMode(['badge', 'compact'])"
    >
      <UIcon name="i-lucide-bot" class="size-4" />
      <span>Assistant</span>
      <span v-if="data.model" class="opacity-70">· {{ data.model }}</span>
    </div>
  </div>
</template>
