<script setup lang="ts">
const props = defineProps<{
  workspaceId: string
}>()

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  close: []
}>()

const sessionStore = useSessionStore()

const name = ref('')
const sourceBranch = ref('')
const targetBranch = ref('main')
const useWorktree = ref(true)
const loading = ref(false)

async function submit() {
  if (!name.value.trim() || !sourceBranch.value.trim() || !targetBranch.value.trim()) return

  loading.value = true
  try {
    await sessionStore.create(props.workspaceId, {
      name: name.value.trim(),
      sourceBranch: sourceBranch.value.trim(),
      targetBranch: targetBranch.value.trim(),
      useWorktree: useWorktree.value,
    })
    name.value = ''
    sourceBranch.value = ''
    targetBranch.value = 'main'
    useWorktree.value = true
    open.value = false
    emit('close')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="New Session"
    description="Create a new Claude Code session in this workspace."
  >
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Session name</label>
          <UInput
            v-model="name"
            placeholder="feat/my-feature"
            icon="i-lucide-terminal"
            autofocus
            required
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Source branch</label>
          <UInput
            v-model="sourceBranch"
            placeholder="feat/my-feature"
            icon="i-lucide-git-branch"
            required
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Target branch</label>
          <UInput
            v-model="targetBranch"
            placeholder="main"
            icon="i-lucide-git-merge"
            required
          />
        </div>

        <USwitch
          v-model="useWorktree"
          label="Use worktree"
          description="Create an isolated git worktree for this session."
        />

        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="open = false; emit('close')"
          />
          <UButton
            label="Create"
            type="submit"
            :loading="loading"
            :disabled="!name.trim() || !sourceBranch.trim() || !targetBranch.trim()"
          />
        </div>
      </form>
    </template>
  </UModal>
</template>
