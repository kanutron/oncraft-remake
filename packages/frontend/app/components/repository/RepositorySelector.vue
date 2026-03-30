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

const path = ref('')
const name = ref('')
const loading = ref(false)
const nameManuallyEdited = ref(false)

const { firstMatch, loading: pathLoading, isGitRepo, lastParent, saveLastParent, defaultRoot } = usePathSuggestions(path)

const pathIcon = computed(() => isGitRepo.value ? 'i-simple-icons-git' : 'i-lucide-folder')

// Track the user's typed length to know where completion starts
let userTypedLength = 0
let completionActive = false

// Template refs for the input elements (modal and inline)
const modalInputRef = ref<{ inputRef?: { value?: HTMLInputElement } } | null>(null)
const inlineInputRef = ref<{ inputRef?: { value?: HTMLInputElement } } | null>(null)

function getInputEl(): HTMLInputElement | null {
  return modalInputRef.value?.inputRef?.value ?? inlineInputRef.value?.inputRef?.value ?? null
}

// When matches arrive, inline-complete the first match
watch(firstMatch, (match) => {
  if (!match || completionActive) return
  const typed = path.value
  // Only complete if the match starts with what was typed (after the last /)
  if (match.path.toLowerCase().startsWith(typed.toLowerCase()) && match.path !== typed) {
    completionActive = true
    userTypedLength = typed.length
    // Set the full path but select the completed portion
    path.value = match.path
    nextTick(() => {
      const el = getInputEl()
      if (el) {
        el.setSelectionRange(userTypedLength, match.path.length)
      }
      completionActive = false
    })
  }
})

function onPathInput(e: Event) {
  const el = e.target as HTMLInputElement
  // When user types, only take their actual input (not the selected completion)
  path.value = el.value
  userTypedLength = el.value.length
}

function onTabKey(e: KeyboardEvent) {
  if (firstMatch.value) {
    e.preventDefault()
    // Accept the current completion and navigate into it
    path.value = `${firstMatch.value.path}/`
    userTypedLength = path.value.length
    // Move cursor to end
    nextTick(() => {
      const el = getInputEl()
      if (el) {
        el.setSelectionRange(path.value.length, path.value.length)
      }
    })
  }
}

// Auto-fill name from last path segment
watch(path, (val) => {
  if (nameManuallyEdited.value || completionActive) return
  const segments = val.split('/').filter(Boolean)
  name.value = segments.length > 0 ? segments[segments.length - 1] : ''
})

// Pre-fill path when dialog opens
watch(open, (isOpen) => {
  if (isOpen && !path.value) {
    const prefill = lastParent.value || defaultRoot.value
    if (prefill) {
      path.value = `${prefill}/`
      userTypedLength = path.value.length
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
