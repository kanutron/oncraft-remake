<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'thinking'; thinking?: string; signature?: string }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, cycleMode } = useRenderMode(props.componentKey, props.defaultMode)

const thinking = computed(() => props.data.thinking ?? '')
const isSigned = computed(() => !thinking.value && !!props.data.signature)
</script>

<template>
  <div
    :data-mode="isSigned ? 'badge' : mode"
    :class="isSigned || mode === 'badge' ? 'inline-flex items-center align-middle' : 'block my-1'"
  >
    <template v-if="isSigned">
      <UBadge color="neutral" variant="subtle" size="sm">
        <UIcon name="i-lucide-brain" class="size-3" />
        <span class="text-xs">thinking (signed)</span>
      </UBadge>
    </template>
    <template v-else-if="mode === 'badge'">
      <UBadge color="primary" variant="subtle" size="sm" class="cursor-pointer" @click="cycleMode()">
        <UIcon name="i-lucide-brain" class="size-3" />
        <span class="text-xs">thinking</span>
      </UBadge>
    </template>
    <template v-else>
      <UChatReasoning
        :default-open="mode === 'full'"
        @update:open="cycleMode()"
      >
        {{ thinking }}
      </UChatReasoning>
    </template>
  </div>
</template>
