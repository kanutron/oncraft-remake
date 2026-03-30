<script setup lang="ts">
const props = defineProps<{
  repositoryId: string
}>()

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  close: []
}>()

const sessionStore = useSessionStore()

const name = ref('')
const sourceBranch = ref('')
const targetBranch = ref('')
const workIsolated = ref(false)
const workBranch = ref('')
const workBranchManuallyEdited = ref(false)
const loading = ref(false)
const error = ref('')

const repositoryIdRef = computed(() => props.repositoryId)
const { items: branchItems, loading: branchLoading, headBranch } = useBranchSuggestions(repositoryIdRef)

// Pre-select HEAD branch as source when branches load
watch(headBranch, (branch) => {
  if (!sourceBranch.value && branch) {
    sourceBranch.value = branch
  }
})

const suggestedWorkBranch = computed(() => {
  if (!name.value.trim()) return ''
  const kebab = name.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return kebab ? `working/${kebab}` : ''
})

// When workIsolated is toggled on, auto-fill if not manually edited
watch(workIsolated, (isolated) => {
  if (isolated && !workBranchManuallyEdited.value && suggestedWorkBranch.value) {
    workBranch.value = suggestedWorkBranch.value
  }
})

// When name changes, update work branch suggestion if not manually edited
watch(name, () => {
  if (!workBranchManuallyEdited.value && workIsolated.value && suggestedWorkBranch.value) {
    workBranch.value = suggestedWorkBranch.value
  }
})

// Detect manual edits to work branch
watch(workBranch, (val) => {
  if (val && val !== suggestedWorkBranch.value) {
    workBranchManuallyEdited.value = true
  }
})

const isValid = computed(() => {
  if (!name.value.trim() || !sourceBranch.value.trim()) return false
  if (workIsolated.value && !workBranch.value.trim()) return false
  return true
})

async function submit() {
  if (!isValid.value) return

  loading.value = true
  error.value = ''
  try {
    await sessionStore.create(props.repositoryId, {
      name: name.value.trim(),
      sourceBranch: sourceBranch.value.trim(),
      workBranch: workIsolated.value ? workBranch.value.trim() : undefined,
      targetBranch: targetBranch.value.trim() || undefined,
    })
    name.value = ''
    sourceBranch.value = ''
    targetBranch.value = ''
    workIsolated.value = false
    workBranch.value = ''
    workBranchManuallyEdited.value = false
    open.value = false
    emit('close')
  } catch (err: unknown) {
    const msg = (err as { data?: { error?: string } })?.data?.error
    error.value = msg || 'Failed to create session'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="New Session"
    description="Create a new Claude Code session in this repository."
  >
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          :title="error"
          icon="i-lucide-alert-circle"
        />

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
          <UInputMenu
            v-model="sourceBranch"
            :items="branchItems"
            :loading="branchLoading"
            icon="i-lucide-git-branch"
            placeholder="main"
            value-key="label"
          />
          <span class="text-xs text-neutral-400 dark:text-neutral-500">Starting point — must be an existing branch</span>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Target branch</label>
          <UInputMenu
            v-model="targetBranch"
            autocomplete
            :items="branchItems"
            :loading="branchLoading"
            icon="i-lucide-git-merge"
            :placeholder="sourceBranch || 'defaults to source'"
          />
          <span class="text-xs text-neutral-400 dark:text-neutral-500">Where work should merge or PR to</span>
        </div>

        <USwitch
          v-model="workIsolated"
          label="Work isolated"
          description="Create a dedicated worktree with its own branch."
        />

        <template v-if="workIsolated">
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Work branch</label>
            <UInputMenu
              v-model="workBranch"
              autocomplete
              :items="branchItems"
              :loading="branchLoading"
              icon="i-lucide-git-fork"
              :placeholder="suggestedWorkBranch || 'feat/my-feature'"
            />
            <span class="text-xs text-neutral-400 dark:text-neutral-500">Branch for this session's commits — will be created if it doesn't exist</span>
          </div>

          <UAlert
            color="info"
            variant="subtle"
            icon="i-lucide-folder-tree"
            :title="`A worktree will be created for branch ${workBranch || '...'}`"
          />
        </template>

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
            :disabled="!isValid"
          />
        </div>
      </form>
    </template>
  </UModal>
</template>
