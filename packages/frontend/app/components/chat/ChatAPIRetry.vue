<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'system'; subtype: 'api_retry'; attempt?: number; error?: string }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, cycleMode } = useRenderMode(props.componentKey, props.defaultMode)
</script>

<template>
  <div :data-mode="mode" :class="mode === 'badge' ? 'inline-flex' : 'block my-2'">
    <template v-if="mode === 'badge'">
      <UBadge color="warning" variant="subtle" class="cursor-pointer" @click="cycleMode(['badge', 'compact'])">
        <UIcon name="i-lucide-refresh-cw" class="size-3" /> retry
      </UBadge>
    </template>
    <template v-else>
      <div class="cursor-pointer" @click="cycleMode(['badge', 'compact'])">
        <UAlert color="warning" variant="subtle" icon="i-lucide-refresh-cw"
          :title="`API retry${data.attempt != null ? ' · attempt ' + data.attempt : ''}`"
          :description="data.error" />
      </div>
    </template>
  </div>
</template>
