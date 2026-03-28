<script setup lang="ts">
import type { Session, SessionState } from '~/types'

const props = defineProps<{
  session: Session
}>()

const stateColor: Record<SessionState, 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'secondary'> = {
  idle: 'neutral',
  starting: 'info',
  active: 'success',
  stopped: 'warning',
  error: 'error',
  completed: 'secondary',
}

const costDisplay = computed(() => {
  const cost = props.session.costUsd
  if (cost === 0) return '$0.00'
  if (cost < 0.01) return '< $0.01'
  return `$${cost.toFixed(2)}`
})

const tokenDisplay = computed(() => {
  const total = props.session.inputTokens + props.session.outputTokens
  if (total === 0) return '0 tokens'
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M tokens`
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}k tokens`
  return `${total} tokens`
})
</script>

<template>
  <div class="flex items-center gap-3 px-4 py-2 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
    <div class="flex items-center gap-2 min-w-0">
      <span class="text-sm font-mono truncate text-neutral-600 dark:text-neutral-400">
        {{ session.sourceBranch }}
      </span>
      <span class="text-neutral-400 dark:text-neutral-500">
        &rarr;
      </span>
      <span class="text-sm font-mono truncate text-neutral-600 dark:text-neutral-400">
        {{ session.targetBranch }}
      </span>
    </div>

    <UBadge
      :label="session.state"
      :color="stateColor[session.state]"
      variant="subtle"
      size="xs"
    />

    <div class="flex-1" />

    <div class="flex items-center gap-3 text-xs text-neutral-400 dark:text-neutral-500">
      <span>{{ costDisplay }}</span>
      <span>{{ tokenDisplay }}</span>
    </div>
  </div>
</template>
