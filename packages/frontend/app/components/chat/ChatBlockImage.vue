<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'image'; source?: { type: 'base64' | 'url'; media_type?: string; data?: string; url?: string } }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, setMode } = useRenderMode(props.componentKey, props.defaultMode)

const src = computed(() => {
  const s = props.data.source
  if (s?.type === 'base64' && s.data && s.media_type) return `data:${s.media_type};base64,${s.data}`
  if (s?.type === 'url' && s.url) return s.url
  return ''
})
</script>

<template>
  <div :data-mode="mode" :class="mode === 'badge' ? 'inline-flex' : 'block my-2'">
    <template v-if="mode === 'badge'">
      <UBadge variant="subtle" class="cursor-pointer" @click="setMode('compact')">
        <UIcon name="i-lucide-image" class="size-3" /> image
      </UBadge>
    </template>
    <template v-else-if="mode === 'compact'">
      <img v-if="src" :src="src" alt="" class="max-h-20 rounded cursor-pointer" @click="setMode('full')" />
    </template>
    <template v-else>
      <img v-if="src" :src="src" alt="" class="max-h-96 rounded" />
    </template>
  </div>
</template>
