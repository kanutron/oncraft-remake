<script setup lang="ts">
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

const activeTab = computed({
  get: () => sessionStore.activeSessionId(props.repositoryId) ?? undefined,
  set: (value) => {
    if (value) sessionStore.setActive(props.repositoryId, String(value))
  },
})

async function closeSession(sessionId: string) {
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
    <div
      v-if="sessions.length"
      class="flex items-center flex-1 min-w-0 overflow-x-auto"
    >
      <button
        v-for="session in sessions"
        :key="session.id"
        class="flex items-center gap-1.5 px-3 py-1.5 text-sm border-b-2 whitespace-nowrap transition-colors group"
        :class="[
          session.id === activeTab
            ? 'border-primary-500 text-primary-600 dark:text-primary-400'
            : 'border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'
        ]"
        @click="activeTab = session.id"
      >
        <span class="truncate max-w-32">{{ session.name }}</span>
        <UBadge
          :label="session.state"
          :color="stateColor[session.state] as any"
          variant="subtle"
          size="xs"
        />
        <UButton
          icon="i-lucide-x"
          size="xs"
          color="neutral"
          variant="ghost"
          square
          class="opacity-0 group-hover:opacity-50 hover:opacity-100! -mr-1"
          @click.stop="closeSession(session.id)"
        />
      </button>
    </div>

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
