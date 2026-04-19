<script setup lang="ts">
const repositoryStore = useRepositoryStore()
const capabilities = useCapabilitiesStore()
const { connect } = useWebSocket()

onMounted(() => {
  repositoryStore.fetchAll()
  connect()
  void capabilities.load()
})
</script>

<template>
  <UApp>
    <div class="flex flex-col h-screen">
      <RepositoryTabBar />
      <div class="flex-1 overflow-hidden">
        <RepositoryView
          v-if="repositoryStore.activeRepository"
          :repository="repositoryStore.activeRepository"
        />
        <div
          v-else
          class="flex items-center justify-center h-full"
        >
          <RepositorySelector :modal="false" />
        </div>
      </div>
    </div>
  </UApp>
</template>
