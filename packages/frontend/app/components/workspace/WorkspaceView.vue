<script setup lang="ts">
import type { Workspace } from '~/types'

const props = defineProps<{
  workspace: Workspace
}>()

const sessionStore = useSessionStore()

const activeSessionId = computed(() => sessionStore.activeSessionId(props.workspace.id))
const activeSession = computed(() =>
  activeSessionId.value ? sessionStore.sessions.get(activeSessionId.value) ?? null : null
)

watch(() => props.workspace.id, (id) => {
  sessionStore.fetchForWorkspace(id)
}, { immediate: true })
</script>

<template>
  <div class="flex flex-col h-full">
    <SessionTabBar :workspace-id="workspace.id" />

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
