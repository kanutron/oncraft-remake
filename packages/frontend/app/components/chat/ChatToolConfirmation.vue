<script setup lang="ts">
import type { RenderMode } from '~/types/chat'
import { toolIcon } from '~/composables/chat/tool-icon'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  sticky?: boolean
  sessionId: string
  data: { type: 'tool_confirmation'; toolUseID?: string; toolName?: string; toolInput?: Record<string, unknown> }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode } = useRenderMode(props.componentKey, props.defaultMode, { sticky: props.sticky })

const sessionStore = useSessionStore()
const icon = computed(() => toolIcon(props.data.toolName))
const summary = computed(() => JSON.stringify(props.data.toolInput ?? {}, null, 2))
const decided = ref(false)

async function decide(decision: 'allow' | 'deny') {
  if (decided.value || !props.data.toolUseID) return
  decided.value = true
  await sessionStore.reply(props.sessionId, props.data.toolUseID, decision)
}
</script>

<template>
  <div v-if="!decided" :data-mode="mode" class="block my-2">
    <UAlert color="warning" variant="subtle" :icon="icon" :title="`Tool confirmation: ${data.toolName ?? 'Unknown'}`">
      <template #description>
        <div class="space-y-2">
          <pre v-if="mode !== 'compact'" class="text-xs font-mono whitespace-pre-wrap">{{ summary }}</pre>
          <div class="flex gap-2">
            <UButton size="sm" color="success" icon="i-lucide-check" @click="decide('allow')">Allow</UButton>
            <UButton size="sm" color="error" variant="subtle" icon="i-lucide-x" @click="decide('deny')">Deny</UButton>
          </div>
        </div>
      </template>
    </UAlert>
  </div>
</template>
