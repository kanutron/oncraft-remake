<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: {
    type: 'result'
    subtype: string
    total_cost_usd?: number
    duration_ms?: number
    usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
  }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, setMode } = useRenderMode(props.componentKey, props.defaultMode)

const isError = computed(() => props.data.subtype?.startsWith('error_') ?? false)
const cost = computed(() => props.data.total_cost_usd != null ? `$${props.data.total_cost_usd.toFixed(4)}` : '—')
const duration = computed(() => props.data.duration_ms != null ? `${(props.data.duration_ms / 1000).toFixed(2)}s` : '—')
const inputTokens = computed(() => props.data.usage?.input_tokens?.toLocaleString() ?? '—')
const outputTokens = computed(() => props.data.usage?.output_tokens?.toLocaleString() ?? '—')
</script>

<template>
  <div :data-mode="mode" :data-error="isError" :class="mode === 'badge' ? 'inline-flex' : 'block my-2'">
    <template v-if="mode === 'badge'">
      <UBadge :color="isError ? 'error' : 'success'" variant="subtle" class="cursor-pointer" @click="setMode('compact')">
        <UIcon :name="isError ? 'i-lucide-circle-x' : 'i-lucide-circle-check'" class="size-3" />
        {{ cost }}
      </UBadge>
    </template>
    <template v-else-if="mode === 'compact'">
      <div class="flex items-center gap-2 text-xs border-t border-neutral-200 dark:border-neutral-800 pt-2">
        <UIcon :name="isError ? 'i-lucide-circle-x' : 'i-lucide-circle-check'" :class="isError ? 'text-error-500' : 'text-success-500'" class="size-4" />
        <span>Turn complete</span>
        <span class="opacity-70">· {{ cost }}</span>
        <span class="opacity-70">· in {{ inputTokens }} / out {{ outputTokens }}</span>
        <span class="opacity-70">· {{ duration }}</span>
        <UButton variant="ghost" size="xs" icon="i-lucide-chevron-down" @click="setMode('full')" />
      </div>
    </template>
    <template v-else>
      <UCard>
        <div class="space-y-1 text-sm">
          <div><strong>Status:</strong> {{ data.subtype }}</div>
          <div><strong>Cost:</strong> {{ cost }}</div>
          <div><strong>Duration:</strong> {{ duration }}</div>
          <div><strong>Tokens:</strong> input {{ inputTokens }} · output {{ outputTokens }}</div>
          <div v-if="data.usage?.cache_read_input_tokens"><strong>Cache read:</strong> {{ data.usage.cache_read_input_tokens.toLocaleString() }}</div>
        </div>
      </UCard>
    </template>
  </div>
</template>
