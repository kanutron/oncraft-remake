<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'text'; text?: string; _parentMessageId?: string }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, cycleMode } = useRenderMode(props.componentKey, props.defaultMode)

const text = computed(() => props.data.text ?? '')
</script>

<template>
  <div
    :data-mode="mode"
    :class="mode === 'badge' ? 'inline-flex items-center gap-1 align-middle' : 'block'"
  >
    <template v-if="mode === 'badge'">
      <UBadge color="neutral" variant="subtle" size="sm" class="cursor-pointer" @click="cycleMode()">
        <UIcon name="i-lucide-message-square" class="size-3" />
        <span class="truncate max-w-[14ch]">{{ text }}</span>
      </UBadge>
    </template>
    <template v-else-if="mode === 'compact'">
      <div class="truncate text-sm leading-6 cursor-pointer" @click="cycleMode()">
        <UIcon name="i-lucide-chevron-right" class="size-3" />
        {{ text }}
      </div>
    </template>
    <template v-else>
      <div class="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap cursor-pointer" @click="cycleMode()">{{ text }}</div>
    </template>
  </div>
</template>
