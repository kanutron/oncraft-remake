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

// Reset source branch when repository changes
watch(repositoryIdRef, () => {
  sourceBranch.value = ''
})

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

// Detect manual edits to work branch; reset flag if cleared
watch(workBranch, (val) => {
  if (!val) {
    workBranchManuallyEdited.value = false
    if (workIsolated.value && suggestedWorkBranch.value) {
      workBranch.value = suggestedWorkBranch.value
    }
  } else if (val !== suggestedWorkBranch.value) {
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
    description="Create a new working session in this repository."
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

        <UFormField label="Session name" required help="Name this session with a short sentence or label">
          <UInput
            v-model="name"
            placeholder="my new feature"
            icon="i-lucide-terminal"
            class="w-full"
            autofocus
          />
        </UFormField>

        <UFormField label="Source branch" required help="Starting point — must be an existing branch">
          <UInputMenu
            v-model="sourceBranch"
            :items="branchItems"
            :loading="branchLoading"
            icon="i-lucide-git-branch"
            placeholder="main"
            value-key="label"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Target branch" help="Where work should merge or PR to — will be created if it doesn't exist">
          <UInputMenu
            v-model="targetBranch"
            autocomplete
            :items="branchItems"
            :loading="branchLoading"
            icon="i-lucide-git-merge"
            :placeholder="sourceBranch || 'defaults to source'"
            :content="{ hideWhenEmpty: true }"
            value-key="label"
            class="w-full"
          />
        </UFormField>

        <USwitch
          v-model="workIsolated"
          label="Work isolated"
          description="Create a dedicated worktree and select or create a branch."
        />

        <template v-if="workIsolated">
          <UFormField label="Work branch" required help="Branch for this session's commits — will be created if it doesn't exist. Used for commits within the worktree">
            <UInputMenu
              v-model="workBranch"
              autocomplete
              :items="branchItems"
              :loading="branchLoading"
              icon="i-lucide-git-fork"
              :placeholder="suggestedWorkBranch || 'feat/my-feature'"
              :content="{ hideWhenEmpty: true }"
              value-key="label"
              class="w-full"
            />
          </UFormField>

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
