<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{ componentKey: string; defaultMode: RenderMode; data: unknown }>()

const { useRenderMode } = useChatRenderMode()
const { mode } = useRenderMode(props.componentKey, props.defaultMode)
</script>

<template>
  <div :data-mode="mode" class="inline-flex items-center align-middle">
    <UBadge variant="subtle" color="neutral" title="Redacted thinking content">
      <UIcon name="i-lucide-eye-off" class="size-3" /> redacted
    </UBadge>
  </div>
</template>
