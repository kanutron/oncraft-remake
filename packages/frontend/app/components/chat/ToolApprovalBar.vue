<script setup lang="ts">
import type { ChatMessage } from '~/types'

const props = defineProps<{
  message: ChatMessage
  sessionId: string
}>()

const sessionStore = useSessionStore()

const data = computed(() => (props.message.raw.data ?? props.message.raw) as Record<string, unknown>)
const toolName = computed(() => (data.value.toolName ?? 'Unknown') as string)
const toolUseID = computed(() => (data.value.toolUseID ?? '') as string)
const toolInput = computed(() => {
  const input = data.value.toolInput
  if (!input) return ''
  return typeof input === 'string' ? input : JSON.stringify(input, null, 2)
})

const decided = ref(false)

async function decide(decision: 'allow' | 'deny') {
  if (decided.value || !toolUseID.value) return
  decided.value = true
  await sessionStore.reply(props.sessionId, toolUseID.value, decision)
}
</script>

<template>
  <div class="px-4 py-3">
    <div class="flex items-start gap-3 rounded-lg border border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-950 p-3">
      <UIcon name="i-lucide-shield-question" class="text-warning-500 shrink-0 mt-0.5" size="20" />

      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium text-warning-800 dark:text-warning-200">
          Tool approval required: {{ toolName }}
        </div>
        <pre
          v-if="toolInput"
          class="mt-2 text-xs font-mono bg-warning-100 dark:bg-warning-900 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-40"
        >{{ toolInput }}</pre>
      </div>

      <div v-if="!decided" class="flex gap-2 shrink-0">
        <UButton
          label="Allow"
          color="success"
          variant="soft"
          size="xs"
          icon="i-lucide-check"
          @click="decide('allow')"
        />
        <UButton
          label="Deny"
          color="error"
          variant="soft"
          size="xs"
          icon="i-lucide-x"
          @click="decide('deny')"
        />
      </div>
      <UBadge v-else label="Responded" color="neutral" variant="subtle" size="sm" />
    </div>
  </div>
</template>
