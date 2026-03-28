<script setup lang="ts">
import type { Repository } from '~/types'

const props = defineProps<{
  repository: Repository
}>()

const sessionStore = useSessionStore()

const activeSessionId = computed(() => sessionStore.activeSessionId(props.repository.id))
const activeSession = computed(() =>
  activeSessionId.value ? sessionStore.sessions.get(activeSessionId.value) ?? null : null
)

watch(() => props.repository.id, (id) => {
  sessionStore.fetchForRepository(id)
}, { immediate: true })
</script>

<template>
  <div class="flex flex-col h-full">
    <SessionTabBar :repository-id="repository.id" />

    <div class="flex-1 overflow-hidden">
      <SessionView
        v-if="activeSession"
        :session-id="activeSession.id"
      />
      <div
        v-else
        class="flex items-center justify-center h-full text-neutral-400 dark:text-neutral-500"
      >
        <p>No session selected. Create one to get started.</p>
      </div>
    </div>
  </div>
</template>
