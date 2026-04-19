<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'bridge:error'; message?: string; [k: string]: unknown }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode } = useRenderMode(props.componentKey, props.defaultMode)
</script>

<template>
  <div :data-mode="mode" class="block my-2">
    <UAlert color="error" variant="subtle" icon="i-lucide-circle-alert" title="Bridge error">
      <template #description>
        <pre class="text-xs font-mono whitespace-pre-wrap">{{ data.message ?? JSON.stringify(data, null, 2) }}</pre>
      </template>
    </UAlert>
  </div>
</template>
