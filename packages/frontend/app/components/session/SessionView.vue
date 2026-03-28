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

    <div class="flex-1 overflow-hidden">
      <ChatHistory :session-id="session.id" />
    </div>

    <PromptBox :session-id="session.id" />
  </div>
</template>
