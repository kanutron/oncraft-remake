<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { path?: string; [k: string]: unknown }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, cycleMode } = useRenderMode(props.componentKey, props.defaultMode)
</script>

<template>
  <div :data-mode="mode" :class="mode === 'badge' ? 'inline-flex' : 'block my-1'">
    <template v-if="mode === 'badge'">
      <UBadge variant="subtle" color="neutral" class="cursor-pointer" @click="cycleMode(['badge', 'compact'])">
        <UIcon name="i-lucide-brain-circuit" class="size-3" /> memory
      </UBadge>
    </template>
    <template v-else>
      <div class="text-xs text-neutral-500 flex items-center gap-1 cursor-pointer" @click="cycleMode(['badge', 'compact'])">
        <UIcon name="i-lucide-brain-circuit" class="size-3" />
        memory recall<span v-if="data.path">: <code>{{ data.path }}</code></span>
      </div>
    </template>
  </div>
</template>
