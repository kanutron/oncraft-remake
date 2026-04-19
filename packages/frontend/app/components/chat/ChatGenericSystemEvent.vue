<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type?: string; subtype?: string; [k: string]: unknown }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, setMode } = useRenderMode(props.componentKey, props.defaultMode)
const label = computed(() => props.data.subtype ?? props.data.type ?? 'event')
</script>

<template>
  <div :data-mode="mode" :class="mode === 'badge' ? 'inline-flex' : 'block my-1'">
    <template v-if="mode === 'badge'">
      <UBadge variant="subtle" color="neutral" class="cursor-pointer" @click="setMode('compact')">
        <UIcon name="i-lucide-info" class="size-3" /> {{ label }}
      </UBadge>
    </template>
    <template v-else-if="mode === 'compact'">
      <div class="text-xs text-neutral-500 flex items-center gap-1">
        <UIcon name="i-lucide-info" class="size-3" />
        <span>{{ label }}</span>
        <UButton variant="ghost" size="xs" icon="i-lucide-chevron-down" @click="setMode('full')" />
      </div>
    </template>
    <template v-else>
      <UAlert color="neutral" variant="subtle" icon="i-lucide-info" :title="label">
        <template #description>
          <pre class="text-xs font-mono whitespace-pre-wrap">{{ JSON.stringify(data, null, 2) }}</pre>
        </template>
      </UAlert>
    </template>
  </div>
</template>
