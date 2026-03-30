<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import type { SessionState } from '~/types'

const props = defineProps<{
  repositoryId: string
}>()

const sessionStore = useSessionStore()
const showNewSession = ref(false)

// Delete confirmation state
const deleteTarget = ref<{ id: string; name: string } | null>(null)
const deleteReason = ref('')
const showDeleteConfirm = ref(false)

const sessions = computed(() => sessionStore.sessionsForRepository(props.repositoryId))

const stateColor: Record<SessionState, string> = {
  idle: 'neutral',
  starting: 'info',
  active: 'success',
  stopped: 'warning',
  error: 'error',
  completed: 'secondary',
}

const tabItems = computed<TabsItem[]>(() =>
  sessions.value.map(s => ({
    label: s.name,
    value: s.id,
  })),
)

const activeTab = computed({
  get: () => sessionStore.activeSessionId(props.repositoryId) ?? undefined,
  set: (value) => {
    if (value) sessionStore.setActive(props.repositoryId, String(value))
  },
})

async function closeSession(sessionId: string, event: Event) {
  event.stopPropagation()
  event.preventDefault()
  const session = sessionStore.sessions.get(sessionId)
  if (!session) return

  const result = await sessionStore.destroy(sessionId)
  if (result.blocked) {
    deleteTarget.value = { id: sessionId, name: session.name }
    deleteReason.value = result.reason ?? 'Session has unsaved work.'
    showDeleteConfirm.value = true
  }
}

async function forceDelete() {
  if (!deleteTarget.value) return
  await sessionStore.destroy(deleteTarget.value.id, { force: true })
  showDeleteConfirm.value = false
  deleteTarget.value = null
}

function cancelDelete() {
  showDeleteConfirm.value = false
  deleteTarget.value = null
}
</script>

<template>
  <div class="flex items-center border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
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
        <UBadge
          :label="sessions.find(s => s.id === item.value)?.state ?? 'idle'"
          :color="(stateColor[sessions.find(s => s.id === item.value)?.state ?? 'idle'] as any)"
          variant="subtle"
          size="xs"
        />
        <span
          role="button"
          tabindex="-1"
          class="inline-flex items-center p-0.5 rounded opacity-0 group-hover:opacity-50 hover:opacity-100 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-opacity cursor-pointer"
          @click="closeSession(String(item.value), $event)"
          @mousedown.prevent
        >
          <UIcon name="i-lucide-x" class="size-3.5" />
        </span>
      </template>
    </UTabs>

    <span
      v-else
      class="flex-1 px-3 text-sm text-neutral-400 dark:text-neutral-500"
    >
      No sessions
    </span>

    <div class="flex items-center px-2">
      <UButton
        icon="i-lucide-plus"
        size="xs"
        color="neutral"
        variant="ghost"
        square
        @click="showNewSession = true"
      />
    </div>

    <SessionNewSessionDialog
      v-model:open="showNewSession"
      :repository-id="repositoryId"
      @close="showNewSession = false"
    />

    <!-- Delete confirmation dialog -->
    <UModal v-model:open="showDeleteConfirm">
      <template #content>
        <div class="p-6 space-y-4">
          <h3 class="text-lg font-semibold">Delete Session?</h3>
          <p class="text-sm text-neutral-600 dark:text-neutral-400">
            {{ deleteReason }}
          </p>
          <p class="text-sm text-neutral-500 dark:text-neutral-500">
            Deleting will remove the worktree and any uncommitted work. This cannot be undone.
          </p>
          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              color="neutral"
              variant="outline"
              @click="cancelDelete"
            />
            <UButton
              label="Delete Anyway"
              color="error"
              @click="forceDelete"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
