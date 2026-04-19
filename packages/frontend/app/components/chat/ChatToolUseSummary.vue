<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'tool_use_summary'; count?: number }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, setMode } = useRenderMode(props.componentKey, props.defaultMode)
</script>

<template>
  <div :data-mode="mode" :class="mode === 'badge' ? 'inline-flex' : 'block my-2'">
    <template v-if="mode === 'badge'">
      <UBadge color="neutral" variant="subtle" class="cursor-pointer" @click="setMode('compact')">
        <UIcon name="i-lucide-list" class="size-3" /> {{ data.count ?? 0 }} tools
      </UBadge>
    </template>
    <template v-else>
      <UAlert color="neutral" variant="subtle" icon="i-lucide-list"
        title="Tool use summary"
        :description="`${data.count ?? 0} tool calls compacted`" />
    </template>
  </div>
</template>
