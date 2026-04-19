<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'system'; subtype: 'notification'; message?: string }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, setMode } = useRenderMode(props.componentKey, props.defaultMode)
</script>

<template>
  <div :data-mode="mode" :class="mode === 'badge' ? 'inline-flex' : 'block my-2'">
    <template v-if="mode === 'badge'">
      <UBadge color="neutral" variant="subtle" class="cursor-pointer" @click="setMode('compact')">
        <UIcon name="i-lucide-bell" class="size-3" /> notice
      </UBadge>
    </template>
    <template v-else>
      <UAlert color="neutral" variant="subtle" icon="i-lucide-bell"
        title="Notification"
        :description="data.message" />
    </template>
  </div>
</template>
