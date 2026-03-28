<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import type { SessionState } from '~/types'

const props = defineProps<{
  repositoryId: string
}>()

const sessionStore = useSessionStore()

const showNewSession = ref(false)

const sessions = computed(() => sessionStore.sessionsForRepository(props.repositoryId))

const stateColor: Record<SessionState, string> = {
  idle: 'neutral',
  starting: 'info',
  active: 'success',
  stopped: 'warning',
  error: 'error',
  completed: 'secondary',
}

const tabItems = computed<TabsItem[]>(() =>
  sessions.value.map(s => ({
    label: s.name,
    value: s.id,
    badge: {
      label: s.state,
      color: stateColor[s.state] as 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'secondary',
      variant: 'subtle' as const,
      size: 'xs' as const,
    },
  }))
)

const activeTab = computed({
  get: () => sessionStore.activeSessionId(props.repositoryId) ?? undefined,
  set: (value) => {
    if (value) sessionStore.setActive(props.repositoryId, String(value))
  },
})
</script>

<template>
  <div class="flex items-center border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
    <UTabs
      v-if="tabItems.length"
      v-model="activeTab"
      :items="tabItems"
      :content="false"
      variant="link"
      size="sm"
      class="flex-1 min-w-0"
    />

    <span
      v-else
      class="flex-1 px-3 text-sm text-neutral-400 dark:text-neutral-500"
    >
      No sessions
    </span>

    <div class="flex items-center px-2">
      <UButton
        icon="i-lucide-plus"
        size="xs"
        color="neutral"
        variant="ghost"
        square
        @click="showNewSession = true"
      />
    </div>

    <SessionNewSessionDialog
      v-model:open="showNewSession"
      :repository-id="repositoryId"
      @close="showNewSession = false"
    />
  </div>
</template>
