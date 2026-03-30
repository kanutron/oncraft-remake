<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'

const repositoryStore = useRepositoryStore()

const showSelector = ref(false)

const tabItems = computed<TabsItem[]>(() =>
  repositoryStore.sortedRepositories.map(r => ({
    label: r.name,
    value: r.id,
  })),
)

const activeTab = computed({
  get: () => repositoryStore.activeRepositoryId ?? undefined,
  set: (value) => {
    if (value) repositoryStore.setActive(String(value))
  },
})

function closeRepository(id: string, event: Event) {
  event.stopPropagation()
  event.preventDefault()
  repositoryStore.close(id)
}
</script>

<template>
  <div class="flex items-center border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
    <UTabs
      v-if="tabItems.length"
      v-model="activeTab"
      :items="tabItems"
      :content="false"
      variant="link"
      size="sm"
      :ui="{ root: 'flex-1 min-w-0', trigger: 'group' }"
    >
      <template #trailing="{ item }">
        <span
          role="button"
          tabindex="-1"
          class="inline-flex items-center p-0.5 rounded opacity-50 hover:opacity-100 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-opacity cursor-pointer"
          @click="closeRepository(String(item.value), $event)"
          @mousedown.prevent
        >
          <UIcon name="i-lucide-x" class="size-3.5" />
        </span>
      </template>
    </UTabs>

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

    <RepositorySelector
      v-model:open="showSelector"
      @close="showSelector = false"
    />
  </div>
</template>
