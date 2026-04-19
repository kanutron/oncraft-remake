<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'system'; subtype: 'compact_boundary'; reason?: string }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode } = useRenderMode(props.componentKey, props.defaultMode)
</script>

<template>
  <div :data-mode="mode" class="block my-3">
    <div class="flex items-center gap-2 text-xs text-neutral-500">
      <div class="flex-1 border-t border-neutral-300 dark:border-neutral-700" />
      <UIcon name="i-lucide-scissors" class="size-3" />
      <span>context compacted<span v-if="data.reason"> · {{ data.reason }}</span></span>
      <div class="flex-1 border-t border-neutral-300 dark:border-neutral-700" />
    </div>
  </div>
</template>
