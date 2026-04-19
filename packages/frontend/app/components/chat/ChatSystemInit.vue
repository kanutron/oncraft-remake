<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'system'; subtype: 'init'; model?: string; cwd?: string; tools?: string[] }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, cycleMode } = useRenderMode(props.componentKey, props.defaultMode)
</script>

<template>
  <div :data-mode="mode" :class="mode === 'badge' ? 'inline-flex items-center' : 'block my-2'">
    <template v-if="mode === 'badge'">
      <UBadge variant="subtle" color="neutral" class="cursor-pointer" @click="cycleMode()">
        <UIcon name="i-lucide-power" class="size-3" />
        <span class="text-xs">session</span>
      </UBadge>
    </template>
    <template v-else-if="mode === 'compact'">
      <div
        class="flex items-center gap-2 text-xs text-neutral-500 border-l-2 border-neutral-400 pl-2 cursor-pointer"
        @click="cycleMode()"
      >
        <UIcon name="i-lucide-power" class="size-3" />
        <span>Session started</span>
        <span v-if="data.model" class="opacity-80">· {{ data.model }}</span>
        <span v-if="data.cwd" class="opacity-60 truncate">· {{ data.cwd }}</span>
      </div>
    </template>
    <template v-else>
      <div class="cursor-pointer" @click="cycleMode()">
        <UAlert color="neutral" variant="subtle" icon="i-lucide-power" :title="`Session started · ${data.model ?? 'unknown model'}`">
          <template #description>
            <div class="space-y-1">
              <div v-if="data.cwd"><span class="opacity-60">cwd:</span> <code>{{ data.cwd }}</code></div>
              <div v-if="data.tools?.length">
                <span class="opacity-60">tools:</span>
                <span v-for="t in data.tools" :key="t" class="inline-block mr-1"><UBadge variant="soft" size="sm">{{ t }}</UBadge></span>
              </div>
            </div>
          </template>
        </UAlert>
      </div>
    </template>
  </div>
</template>
