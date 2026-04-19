<script setup lang="ts">
import { resolveChatComponent } from '~/composables/chat/resolve-component'

const props = defineProps<{ sessionId: string }>()

const sessionStore = useSessionStore()
const messages = computed(() => sessionStore.messagesForSession(props.sessionId))

const { components, sideChannel } = useChatReducer(messages)

provide('chat:side-channel', sideChannel)

const stickyItems = computed(() => components.value.filter(c => c.sticky))
const streamItems = computed(() => components.value.filter(c => !c.sticky))

// Auto-scroll
const scrollContainer = ref<HTMLElement | null>(null)
const shouldAutoScroll = ref(true)

function onScroll() {
  if (!scrollContainer.value) return
  const { scrollTop, scrollHeight, clientHeight } = scrollContainer.value
  shouldAutoScroll.value = scrollHeight - scrollTop - clientHeight < 80
}

watch(() => streamItems.value.length, async () => {
  if (!shouldAutoScroll.value) return
  await nextTick()
  scrollContainer.value?.scrollTo({ top: scrollContainer.value.scrollHeight, behavior: 'smooth' })
})

onMounted(async () => {
  await nextTick()
  scrollContainer.value?.scrollTo({ top: scrollContainer.value!.scrollHeight })
})
</script>

<template>
  <div ref="scrollContainer" class="flex-1 overflow-y-auto relative" @scroll="onScroll">
    <ChatStickyRegion v-if="stickyItems.length" :items="stickyItems" :session-id="sessionId" />

    <div class="max-w-4xl mx-auto px-2 py-4">
      <template v-if="streamItems.length === 0">
        <div class="flex items-center justify-center min-h-50 text-neutral-400 dark:text-neutral-500">
          <p>No messages yet. Send a prompt to start the conversation.</p>
        </div>
      </template>

      <template v-for="item in streamItems" :key="item.componentKey">
        <component
          :is="resolveChatComponent(item.kind)"
          v-if="resolveChatComponent(item.kind)"
          :component-key="item.componentKey"
          :default-mode="item.defaultMode"
          :data="item.data"
          :status="item.status"
          :session-id="sessionId"
        />
      </template>
    </div>
  </div>
</template>
