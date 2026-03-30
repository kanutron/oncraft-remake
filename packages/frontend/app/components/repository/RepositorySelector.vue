<script setup lang="ts">
const props = withDefaults(defineProps<{
  /** When true, renders inside a UModal. When false, renders the form inline. */
  modal?: boolean
}>(), {
  modal: true,
})

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  close: []
}>()

const repositoryStore = useRepositoryStore()

// userInput: what the user actually typed — drives the composable fetching
// path: what's displayed in the input — may include inline completion suffix
const userInput = ref('')
const path = ref('')
const name = ref('')
const loading = ref(false)
const nameManuallyEdited = ref(false)

const { firstMatch, loading: pathLoading, isGitRepo, lastParent, saveLastParent, defaultRoot } = usePathSuggestions(userInput)

const pathIcon = computed(() => isGitRepo.value ? 'i-simple-icons-git' : 'i-lucide-folder')

// Guard to prevent completion from being treated as user input
let settingCompletion = false

// Template refs for the UInput components
const modalInputRef = ref<{ inputRef: Ref<HTMLInputElement | null> } | null>(null)
const inlineInputRef = ref<{ inputRef: Ref<HTMLInputElement | null> } | null>(null)

function getInputEl(): HTMLInputElement | null {
  return modalInputRef.value?.inputRef?.value ?? inlineInputRef.value?.inputRef?.value ?? null
}

// When a match arrives, inline-complete: show the full path with the suffix selected
watch(firstMatch, (match) => {
  if (!match) return
  const typed = userInput.value
  if (!typed) return
  // Only complete if match starts with what was typed and is longer
  if (match.path.toLowerCase().startsWith(typed.toLowerCase()) && match.path.length > typed.length) {
    settingCompletion = true
    path.value = match.path
    nextTick(() => {
      const el = getInputEl()
      if (el) {
        el.value = match.path
        el.setSelectionRange(typed.length, match.path.length)
      }
      settingCompletion = false
    })
  }
})

function onPathInput(val: string) {
  if (settingCompletion) return
  userInput.value = val
  path.value = val
}

function onTabKey(e: KeyboardEvent) {
  if (firstMatch.value) {
    e.preventDefault()
    // Accept the completion and descend into the directory
    const completed = `${firstMatch.value.path}/`
    settingCompletion = true
    userInput.value = completed
    path.value = completed
    nextTick(() => {
      const el = getInputEl()
      if (el) {
        el.value = completed
        el.setSelectionRange(completed.length, completed.length)
      }
      settingCompletion = false
    })
  }
}

// Auto-fill name from last path segment (only from user-committed input)
watch(userInput, (val) => {
  if (nameManuallyEdited.value) return
  const segments = val.split('/').filter(Boolean)
  name.value = segments.length > 0 ? segments[segments.length - 1] : ''
})

// Pre-fill path when dialog opens
watch(open, (isOpen) => {
  if (isOpen && !path.value) {
    const prefill = lastParent.value || defaultRoot.value
    if (prefill) {
      const initial = `${prefill}/`
      userInput.value = initial
      path.value = initial
    }
  }
})

function onNameInput() {
  nameManuallyEdited.value = true
}

async function submit() {
  if (!path.value.trim()) return

  loading.value = true
  try {
    await repositoryStore.open(path.value.trim(), name.value.trim() || undefined)
    saveLastParent(path.value.trim())
    userInput.value = ''
    path.value = ''
    name.value = ''
    nameManuallyEdited.value = false
    open.value = false
    emit('close')
  } finally {
    loading.value = false
  }
}

function cancel() {
  userInput.value = ''
  path.value = ''
  name.value = ''
  nameManuallyEdited.value = false
  open.value = false
  emit('close')
}
</script>

<template>
  <!-- Modal mode: triggered from RepositoryTabBar -->
  <UModal
    v-if="modal"
    v-model:open="open"
    title="Add Repository"
    description="Add a git repository to this project."
  >
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Repository path</label>
          <UInput
            ref="modalInputRef"
            :model-value="path"
            :icon="pathIcon"
            :loading="pathLoading"
            placeholder="/path/to/repository"
            autofocus
            :color="isGitRepo ? 'success' : undefined"
            :highlight="isGitRepo"
            :ui="{ leadingIcon: isGitRepo ? 'text-success-500' : '' }"
            @update:model-value="onPathInput"
            @keydown.tab="onTabKey"
          />
          <span class="text-xs text-neutral-400 dark:text-neutral-500">Type a path — Tab to autocomplete</span>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Name (optional)</label>
          <UInput
            v-model="name"
            placeholder="Display name"
            icon="i-lucide-tag"
            @input="onNameInput"
          />
        </div>

        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="cancel"
          />
          <UButton
            label="Add"
            type="submit"
            :loading="loading"
            :disabled="!path.trim()"
          />
        </div>
      </form>
    </template>
  </UModal>

  <!-- Inline mode: empty state when no repositories are open -->
  <div v-else class="w-full max-w-md p-6">
    <h2 class="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
      Add Repository
    </h2>
    <p class="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
      Add a git repository to get started.
    </p>

    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Repository path</label>
        <UInput
          ref="inlineInputRef"
          :model-value="path"
          :icon="pathIcon"
          :loading="pathLoading"
          placeholder="/path/to/repository"
          autofocus
          :color="isGitRepo ? 'success' : undefined"
          :highlight="isGitRepo"
          :ui="{ leadingIcon: isGitRepo ? 'text-success-500' : '' }"
          @input="onPathInput"
          @keydown.tab="onTabKey"
        />
        <span class="text-xs text-neutral-400 dark:text-neutral-500">Type a path — Tab to autocomplete</span>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Name (optional)</label>
        <UInput
          v-model="name"
          placeholder="Display name"
          icon="i-lucide-tag"
          @input="onNameInput"
        />
      </div>

      <div class="flex justify-end">
        <UButton
          label="Add Repository"
          type="submit"
          :loading="loading"
          :disabled="!path.trim()"
        />
      </div>
    </form>
  </div>
</template>
