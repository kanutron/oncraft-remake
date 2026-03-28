<script setup lang="ts">
const props = defineProps<{
  sessionId: string
}>()

const sessionStore = useSessionStore()

const session = computed(() => sessionStore.sessions.get(props.sessionId) ?? null)
</script>

<template>
  <div v-if="session" class="flex flex-col h-full">
    <SessionHeader :session="session" />

    <!-- Chat area placeholder (Task 9.3) -->
    <div class="flex-1 flex items-center justify-center text-neutral-400 dark:text-neutral-500">
      <p>No messages yet. Send a prompt to start the conversation.</p>
    </div>
  </div>
</template>
