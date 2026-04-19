<script setup lang="ts">
import type { ChatStreamComponent } from '~/types/chat'
import { resolveChatComponent } from '~/composables/chat/resolve-component'

defineProps<{
  items: ChatStreamComponent[]
  sessionId: string
}>()
</script>

<template>
  <div class="sticky top-0 z-10 bg-default/90 backdrop-blur-sm border-b border-default">
    <div class="max-w-4xl mx-auto px-2 py-1 space-y-1">
      <template v-for="item in items" :key="item.componentKey">
        <component
          :is="resolveChatComponent(item.kind)"
          v-if="resolveChatComponent(item.kind)"
          :component-key="item.componentKey"
          :default-mode="item.defaultMode"
          :data="item.data"
          :status="item.status"
          :sticky="true"
          :session-id="sessionId"
        />
      </template>
    </div>
  </div>
</template>
