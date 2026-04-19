<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  status?: 'running' | 'success' | 'error' | 'streaming' | 'cancelled'
  data: { hook_event?: string; hook_callback_id?: string; decision?: string; progress?: string; [k: string]: unknown }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, setMode } = useRenderMode(props.componentKey, props.defaultMode)
const icon = computed(() => props.status === 'error' ? 'i-lucide-shield-x' : 'i-lucide-shield-check')
</script>

<template>
  <div :data-mode="mode" :class="mode === 'badge' ? 'inline-flex' : 'block my-1'">
    <template v-if="mode === 'badge'">
      <UBadge color="neutral" variant="subtle" class="cursor-pointer" @click="setMode('compact')">
        <UIcon :name="icon" class="size-3" /> hook
      </UBadge>
    </template>
    <template v-else>
      <UAlert
        :color="status === 'error' ? 'error' : 'neutral'"
        variant="subtle"
        :icon="icon"
        :title="`Hook · ${data.hook_event ?? 'unknown'}`"
        :description="data.decision ?? data.progress ?? ''"
      />
    </template>
  </div>
</template>
