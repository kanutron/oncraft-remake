<script setup lang="ts">
import { resolveChatComponent } from '~/composables/chat/resolve-component'

const props = defineProps<{ sessionId: string }>()

const sessionStore = useSessionStore()
const messages = computed(() => sessionStore.messagesForSession(props.sessionId))

const { components, sideChannel } = useChatReducer(messages)

provide('chat:side-channel', sideChannel)

const stickyItems = computed(() => components.value.filter(c => c.sticky))
const streamItems = computed(() => components.value.filter(c => !c.sticky))

const lastUserMessage = computed(() => {
  for (let i = streamItems.value.length - 1; i >= 0; i--) {
    if (streamItems.value[i]!.kind === 'user') return streamItems.value[i]
  }
  return null
})

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

// Floating sticky for the last user message — shown only when the inline copy
// scrolls above the viewport. IO watches the inline element; isIntersecting=false
// reveals the sticky copy.
const isLastUserVisible = ref(true)
const lastUserEl = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

function teardownObserver() {
  observer?.disconnect()
  observer = null
}

function setupObserver() {
  teardownObserver()
  if (!scrollContainer.value || !lastUserEl.value) return
  observer = new IntersectionObserver(
    ([entry]) => { isLastUserVisible.value = entry!.isIntersecting },
    { root: scrollContainer.value, threshold: 0 },
  )
  observer.observe(lastUserEl.value)
}

watch(
  () => lastUserMessage.value?.componentKey,
  async (key) => {
    if (!key) {
      teardownObserver()
      isLastUserVisible.value = true
      return
    }
    await nextTick()
    setupObserver()
  },
  { immediate: true },
)

onBeforeUnmount(teardownObserver)

const showStickyUser = computed(() => !!lastUserMessage.value && !isLastUserVisible.value)
</script>

<template>
  <div ref="scrollContainer" class="flex-1 overflow-y-auto relative" @scroll="onScroll">
    <ChatStickyRegion v-if="stickyItems.length" :items="stickyItems" :session-id="sessionId" />

    <div
      v-if="showStickyUser && lastUserMessage"
      class="sticky top-0 z-20 bg-default/90 backdrop-blur-sm border-b border-default"
    >
      <div class="max-w-4xl mx-auto px-2 py-1 max-h-24 overflow-y-auto">
        <component
          :is="resolveChatComponent(lastUserMessage.kind)"
          v-if="resolveChatComponent(lastUserMessage.kind)"
          :component-key="`${lastUserMessage.componentKey}:sticky`"
          :default-mode="lastUserMessage.defaultMode"
          :data="lastUserMessage.data"
          :status="lastUserMessage.status"
          :sticky="true"
          :session-id="sessionId"
        />
      </div>
    </div>

    <div class="max-w-4xl mx-auto px-2 py-4">
      <template v-if="streamItems.length === 0">
        <div class="flex items-center justify-center min-h-50 text-neutral-400 dark:text-neutral-500">
          <p>No messages yet. Send a prompt to start the conversation.</p>
        </div>
      </template>

      <template v-for="item in streamItems" :key="item.componentKey">
        <div
          v-if="item.componentKey === lastUserMessage?.componentKey"
          ref="lastUserEl"
        >
          <component
            :is="resolveChatComponent(item.kind)"
            v-if="resolveChatComponent(item.kind)"
            :component-key="item.componentKey"
            :default-mode="item.defaultMode"
            :data="item.data"
            :status="item.status"
            :session-id="sessionId"
          />
        </div>
        <component
          v-else
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
