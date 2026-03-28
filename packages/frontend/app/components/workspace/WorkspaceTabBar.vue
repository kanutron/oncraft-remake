<script setup lang="ts">
const workspaceStore = useWorkspaceStore()

const showSelector = ref(false)

function selectWorkspace(id: string) {
  workspaceStore.setActive(id)
}

function closeWorkspace(id: string) {
  workspaceStore.close(id)
}
</script>

<template>
  <div class="flex items-center border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
    <div class="flex items-center flex-1 min-w-0 overflow-x-auto">
      <button
        v-for="ws in workspaceStore.sortedWorkspaces"
        :key="ws.id"
        class="flex items-center gap-1 px-3 py-1.5 text-sm border-b-2 whitespace-nowrap transition-colors"
        :class="[
          ws.id === workspaceStore.activeWorkspaceId
            ? 'border-primary-500 text-primary-600 dark:text-primary-400'
            : 'border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'
        ]"
        @click="selectWorkspace(ws.id)"
      >
        <span class="truncate max-w-40">{{ ws.name }}</span>
        <UButton
          icon="i-lucide-x"
          size="xs"
          color="neutral"
          variant="ghost"
          square
          class="ml-1 opacity-50 hover:opacity-100"
          @click.stop="closeWorkspace(ws.id)"
        />
      </button>
    </div>

    <div class="flex items-center px-2 shrink-0">
      <UButton
        icon="i-lucide-plus"
        size="xs"
        color="neutral"
        variant="ghost"
        square
        @click="showSelector = true"
      />
    </div>

    <WorkspaceSelector
      v-model:open="showSelector"
      @close="showSelector = false"
    />
  </div>
</template>
