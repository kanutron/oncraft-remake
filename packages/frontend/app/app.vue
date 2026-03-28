<script setup lang="ts">
const workspaceStore = useWorkspaceStore()
const { connect } = useWebSocket()

onMounted(() => {
  workspaceStore.fetchAll()
  connect()
})
</script>

<template>
  <UApp>
    <div class="flex flex-col h-screen">
      <WorkspaceTabBar />
      <div class="flex-1 overflow-hidden">
        <WorkspaceView
          v-if="workspaceStore.activeWorkspace"
          :workspace="workspaceStore.activeWorkspace"
        />
        <div
          v-else
          class="flex items-center justify-center h-full"
        >
          <WorkspaceSelector :modal="false" />
        </div>
      </div>
    </div>
  </UApp>
</template>
