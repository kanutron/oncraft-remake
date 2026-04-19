<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  status?: 'running' | 'success' | 'error' | 'streaming' | 'cancelled'
  data: { task_id?: string; description?: string; progress?: string; [k: string]: unknown }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, setMode } = useRenderMode(props.componentKey, props.defaultMode)
</script>

<template>
  <div :data-mode="mode" :class="mode === 'badge' ? 'inline-flex' : 'block my-1'">
    <template v-if="mode === 'badge'">
      <UBadge color="primary" variant="subtle" class="cursor-pointer" @click="setMode('compact')">
        <UIcon name="i-lucide-bot" class="size-3" /> task
      </UBadge>
    </template>
    <template v-else>
      <UAlert color="primary" variant="subtle" icon="i-lucide-bot"
        :title="data.description ?? 'Task'"
        :description="data.progress" />
    </template>
  </div>
</template>
