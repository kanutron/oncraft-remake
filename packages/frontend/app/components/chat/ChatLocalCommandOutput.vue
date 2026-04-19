<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'system'; subtype: 'local_command_output'; command?: string; stdout?: string; stderr?: string }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, cycleMode } = useRenderMode(props.componentKey, props.defaultMode)
</script>

<template>
  <div :data-mode="mode" :class="mode === 'badge' ? 'inline-flex' : 'block my-2'">
    <template v-if="mode === 'badge'">
      <UBadge color="neutral" variant="subtle" class="cursor-pointer" @click="cycleMode()">
        <UIcon name="i-lucide-terminal-square" class="size-3" /> {{ data.command ?? 'command' }}
      </UBadge>
    </template>
    <template v-else-if="mode === 'compact'">
      <div class="flex items-center gap-2 text-xs text-neutral-500 cursor-pointer" @click="cycleMode()">
        <UIcon name="i-lucide-terminal-square" class="size-3" />
        <span>Local command · {{ data.command ?? '' }}</span>
      </div>
    </template>
    <template v-else>
      <div class="cursor-pointer" @click="cycleMode()">
        <UAlert color="neutral" variant="subtle" icon="i-lucide-terminal-square"
          :title="`Local command · ${data.command ?? ''}`">
          <template #description>
            <pre v-if="data.stdout" class="text-xs font-mono whitespace-pre-wrap">{{ data.stdout }}</pre>
            <pre v-if="data.stderr" class="text-xs font-mono whitespace-pre-wrap text-error-500">{{ data.stderr }}</pre>
          </template>
        </UAlert>
      </div>
    </template>
  </div>
</template>
