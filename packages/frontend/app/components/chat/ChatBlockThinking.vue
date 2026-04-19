<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'thinking'; thinking?: string }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, setMode } = useRenderMode(props.componentKey, props.defaultMode)

const thinking = computed(() => props.data.thinking ?? '')
</script>

<template>
  <div
    :data-mode="mode"
    :class="mode === 'badge' ? 'inline-flex items-center align-middle' : 'block my-1'"
  >
    <template v-if="mode === 'badge'">
      <UBadge color="primary" variant="subtle" size="sm" class="cursor-pointer" @click="setMode('compact')">
        <UIcon name="i-lucide-brain" class="size-3" />
        <span class="text-xs">thinking</span>
      </UBadge>
    </template>
    <template v-else>
      <UChatReasoning
        :default-open="mode === 'full'"
        @update:open="(o: boolean) => setMode(o ? 'full' : 'compact')"
      >
        {{ thinking }}
      </UChatReasoning>
    </template>
  </div>
</template>
