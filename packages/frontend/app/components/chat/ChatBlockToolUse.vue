<script setup lang="ts">
import type { ComputedRef } from 'vue'
import type { RenderMode } from '~/types/chat'
import type { SubagentEntry } from '~/stores/session.store'
import { toolIcon } from '~/composables/chat/tool-icon'
import ChatSubagentTranscript from '~/components/chat/ChatSubagentTranscript.vue'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  status?: 'streaming' | 'running' | 'success' | 'error' | 'cancelled'
  sessionId?: string
  data: {
    type: 'tool_use'
    id: string
    name?: string
    input?: Record<string, unknown>
    tool_result?: { content: unknown; is_error: boolean }
  }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, cycleMode } = useRenderMode(props.componentKey, props.defaultMode)

const icon = computed(() => toolIcon(props.data.name))
const label = computed(() => props.data.name ?? 'Tool')
const inputSummary = computed(() => {
  const input = props.data.input
  if (!input) return ''
  if (typeof input === 'string') return input
  for (const v of Object.values(input)) if (typeof v === 'string' && v) return v
  return JSON.stringify(input)
})
const outputText = computed(() => {
  const c = props.data.tool_result?.content
  if (typeof c === 'string') return c
  return JSON.stringify(c, null, 2)
})

const isError = computed(() => props.status === 'error')
const isStreaming = computed(() => props.status === 'streaming' || props.status === 'running')

const subagentMap = inject<ComputedRef<Map<string, SubagentEntry>> | null>('chat:subagent-map', null)
const subagent = computed<SubagentEntry | null>(() => {
  if (props.data.name !== 'Agent') return null
  return subagentMap?.value?.get(props.data.id) ?? null
})

const sessionStore = useSessionStore()
const liveMessages = computed<Record<string, unknown>[]>(() =>
  props.data.name === 'Agent' ? sessionStore.liveSubagentMessagesFor(props.data.id) : [],
)

/**
 * Merge hydrated (.jsonl on disk) with live (inline SDK stream) subagent
 * messages. Dedup by uuid — while the run is active, live is authoritative
 * and complete; after the run, hydrated is authoritative. Both carry uuids,
 * so dedup keeps the ordering stable across the transition.
 */
const mergedSubagentMessages = computed<Record<string, unknown>[]>(() => {
  const hydrated = subagent.value?.messages ?? []
  const live = liveMessages.value
  if (hydrated.length === 0) return live
  if (live.length === 0) return hydrated
  const seen = new Set<string>()
  const out: Record<string, unknown>[] = []
  for (const m of [...hydrated, ...live]) {
    const uuid = (m as { uuid?: string }).uuid ?? JSON.stringify(m)
    if (seen.has(uuid)) continue
    seen.add(uuid)
    out.push(m)
  }
  return out
})

const subagentMeta = computed<{ agentId: string; agentType?: string; description?: string } | null>(() => {
  if (subagent.value) {
    return {
      agentId: subagent.value.agentId,
      agentType: subagent.value.agentType,
      description: subagent.value.description,
    }
  }
  if (props.data.name === 'Agent' && liveMessages.value.length > 0) {
    const input = (props.data.input ?? {}) as { subagent_type?: string; description?: string }
    return {
      agentId: `live:${props.data.id}`,
      agentType: input.subagent_type,
      description: input.description,
    }
  }
  return null
})

const hasSubagentContent = computed(() =>
  subagentMeta.value !== null && mergedSubagentMessages.value.length > 0,
)
</script>

<template>
  <div
    :data-mode="mode"
    :data-status="status ?? 'unknown'"
    :class="mode === 'badge' ? 'inline-flex items-center mr-1 align-middle' : 'block my-1'"
  >
    <template v-if="mode === 'badge'">
      <UBadge
        :color="isError ? 'error' : 'neutral'"
        variant="subtle"
        size="sm"
        class="cursor-pointer"
        @click="cycleMode()"
      >
        <UIcon :name="icon" class="size-3" />
        <span class="text-xs">{{ label }}</span>
        <UIcon v-if="isStreaming" name="i-lucide-loader-circle" class="size-3 animate-spin" />
      </UBadge>
    </template>

    <template v-else-if="mode === 'compact'">
      <UChatTool
        variant="inline"
        :icon="icon"
        :text="label"
        :suffix="inputSummary.slice(0, 80)"
        :streaming="isStreaming"
        :loading="isStreaming"
        :defaultOpen="true"
        @update:open="cycleMode()"
      >
        <div class="space-y-2" @click.stop>
          <pre v-if="data.tool_result" class="text-xs font-mono bg-neutral-100 dark:bg-neutral-900 rounded p-2 whitespace-pre-wrap">{{ outputText }}</pre>
          <ChatSubagentTranscript
            v-if="hasSubagentContent && subagentMeta && sessionId"
            :agent-id="subagentMeta.agentId"
            :agent-type="subagentMeta.agentType"
            :description="subagentMeta.description"
            :messages="mergedSubagentMessages"
            :session-id="sessionId"
          />
        </div>
      </UChatTool>
    </template>

    <template v-else>
      <UChatTool
        variant="card"
        :icon="icon"
        :text="label"
        :suffix="inputSummary.slice(0, 80)"
        :streaming="isStreaming"
        :loading="isStreaming"
        :defaultOpen="true"
        @update:open="cycleMode()"
      >
        <div class="space-y-2" @click.stop>
          <pre class="text-xs font-mono bg-neutral-100 dark:bg-neutral-900 rounded p-2 whitespace-pre-wrap">{{ JSON.stringify(data.input, null, 2) }}</pre>
          <pre v-if="data.tool_result" class="text-xs font-mono bg-neutral-100 dark:bg-neutral-900 rounded p-2 whitespace-pre-wrap">{{ outputText }}</pre>
          <ChatSubagentTranscript
            v-if="hasSubagentContent && subagentMeta && sessionId"
            :agent-id="subagentMeta.agentId"
            :agent-type="subagentMeta.agentType"
            :description="subagentMeta.description"
            :messages="mergedSubagentMessages"
            :session-id="sessionId"
          />
        </div>
      </UChatTool>
    </template>
  </div>
</template>
