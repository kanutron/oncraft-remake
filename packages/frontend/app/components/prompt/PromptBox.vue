<script setup lang="ts">
const props = defineProps<{
  sessionId: string
}>()

const sessionStore = useSessionStore()

const session = computed(() => sessionStore.sessions.get(props.sessionId) ?? null)

const promptText = ref('')
const isSubmitting = ref(false)

const isActive = computed(() => session.value?.state === 'active')
const isDisabled = computed(() => {
  if (!session.value) return true
  return session.value.state === 'error' || session.value.state === 'completed'
})

const chatStatus = computed(() => {
  if (!session.value) return 'ready'
  if (isSubmitting.value) return 'submitted'
  if (session.value.state === 'active' || session.value.state === 'starting') return 'streaming'
  if (session.value.state === 'error') return 'error'
  return 'ready'
})

// Read toolbar values via provide/inject or template ref
const toolbarRef = ref<{ model: Ref<string>; effort: Ref<string> } | null>(null)

async function handleSubmit() {
  const text = promptText.value.trim()
  if (!text || isDisabled.value) return

  isSubmitting.value = true
  try {
    const model = toolbarRef.value?.model.value
    const effort = toolbarRef.value?.effort.value
    await sessionStore.send(props.sessionId, text, { model, effort })
    promptText.value = ''
  } finally {
    isSubmitting.value = false
  }
}

async function handleInterrupt() {
  await sessionStore.interrupt(props.sessionId)
}

defineExpose({ toolbarRef })
</script>

<template>
  <div class="border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
    <PromptToolbar ref="toolbarRef" />

    <div class="px-4 pb-4">
      <UChatPrompt
        v-model="promptText"
        :disabled="isDisabled"
        :placeholder="isActive ? 'Session is running...' : 'Send a message...'"
        variant="outline"
        autofocus
        @submit="handleSubmit"
      >
        <UChatPromptSubmit
          :status="chatStatus as any"
          color="neutral"
          @stop="handleInterrupt"
        />
      </UChatPrompt>
    </div>
  </div>
</template>
