<script setup lang="ts">
import { resolveChatComponent } from '~/composables/chat/resolve-component'
import { useSubagentCorrelation } from '~/composables/chat/use-subagent-correlation'

const props = defineProps<{ sessionId: string }>()

const sessionStore = useSessionStore()
const messages = computed(() => sessionStore.messagesForSession(props.sessionId))

const { components, sideChannel } = useChatReducer(messages)

provide('chat:side-channel', sideChannel)

const sessionIdRef = computed(() => props.sessionId)
const subagentMap = useSubagentCorrelation(sessionIdRef)
provide('chat:subagent-map', subagentMap)

const stickyItems = computed(() => components.value.filter(c => c.sticky))
const streamItems = computed(() => components.value.filter(c => !c.sticky))

type StreamItem = (typeof streamItems.value)[number]

// Auto-scroll
const scrollContainer = ref<HTMLElement | null>(null)
const shouldAutoScroll = ref(true)

function onScroll() {
  if (!scrollContainer.value) return
  const { scrollTop, scrollHeight, clientHeight } = scrollContainer.value
  shouldAutoScroll.value = scrollHeight - scrollTop - clientHeight < 80
  updateStickyUser()
}

watch(() => streamItems.value.length, async () => {
  await nextTick()
  if (shouldAutoScroll.value) {
    scrollContainer.value?.scrollTo({ top: scrollContainer.value.scrollHeight, behavior: 'smooth' })
  }
  updateStickyUser()
})

onMounted(async () => {
  await nextTick()
  scrollContainer.value?.scrollTo({ top: scrollContainer.value!.scrollHeight })
  updateStickyUser()
})

// Floating sticky: show the most recent user message whose bottom has scrolled
// above the top of the scroll container — i.e. the latest user message no
// longer visible from the current scroll point upward.
const userEls = new Map<string, HTMLElement>()
const stickyUserItem = shallowRef<StreamItem | null>(null)

function setUserRef(key: string, el: Element | null) {
  if (el) userEls.set(key, el as HTMLElement)
  else userEls.delete(key)
}

function updateStickyUser() {
  if (!scrollContainer.value) { stickyUserItem.value = null; return }
  const containerTop = scrollContainer.value.getBoundingClientRect().top
  let latest: StreamItem | null = null
  for (const item of streamItems.value) {
    if (item.kind !== 'user') continue
    const el = userEls.get(item.componentKey)
    if (!el) continue
    if (el.getBoundingClientRect().bottom <= containerTop) latest = item
    else break
  }
  stickyUserItem.value = latest
}
</script>

<template>
  <div ref="scrollContainer" class="flex-1 overflow-y-auto relative" @scroll="onScroll">
    <ChatStickyRegion v-if="stickyItems.length" :items="stickyItems" :session-id="sessionId" />

    <div
      v-if="stickyUserItem"
      class="sticky top-0 z-20 bg-default/90 backdrop-blur-sm border-b border-default"
    >
      <div class="max-w-4xl mx-auto px-2 py-1 max-h-24 overflow-y-auto">
        <component
          :is="resolveChatComponent(stickyUserItem.kind)"
          v-if="resolveChatComponent(stickyUserItem.kind)"
          :component-key="`${stickyUserItem.componentKey}:sticky`"
          :default-mode="stickyUserItem.defaultMode"
          :data="stickyUserItem.data"
          :status="stickyUserItem.status"
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
          v-if="item.kind === 'user'"
          :ref="el => setUserRef(item.componentKey, el as Element | null)"
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
