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

// Template refs for the UInput components
const modalInputRef = ref<{ inputRef: Ref<HTMLInputElement | null> } | null>(null)
const inlineInputRef = ref<{ inputRef: Ref<HTMLInputElement | null> } | null>(null)

function getInputEl(): HTMLInputElement | null {
  return modalInputRef.value?.inputRef?.value ?? inlineInputRef.value?.inputRef?.value ?? null
}

// Shell-style inline completion
// When matches arrive, show the first match's remaining text as selected text
let isCompleting = false

watch(firstMatch, (match) => {
  if (!match || isCompleting) return
  const typed = path.value
  if (!typed || typeof typed !== 'string') return

  if (match.path.toLowerCase().startsWith(typed.toLowerCase()) && match.path.length > typed.length) {
    isCompleting = true
    // Directly set the DOM input value and select the completion suffix
    // Don't change path.value — we only change the DOM display
    nextTick(() => {
      const el = getInputEl()
      if (el) {
        el.value = match.path
        el.setSelectionRange(typed.length, match.path.length)
      }
      isCompleting = false
    })
  }
})

function onTabKey(e: KeyboardEvent) {
  const el = getInputEl()
  if (!el) return

  // If there's a selection (completion suffix), accept it
  if (el.selectionStart !== el.selectionEnd && firstMatch.value) {
    e.preventDefault()
    const completed = `${firstMatch.value.path}/`
    path.value = completed
    nextTick(() => {
      if (el) {
        el.value = completed
        el.setSelectionRange(completed.length, completed.length)
      }
    })
    return
  }

  // If there's a single match but no selection, accept it too
  if (firstMatch.value) {
    e.preventDefault()
    const completed = `${firstMatch.value.path}/`
    path.value = completed
    nextTick(() => {
      if (el) {
        el.value = completed
        el.setSelectionRange(completed.length, completed.length)
      }
    })
  }
}

// Auto-fill name from last path segment
watch(path, (val) => {
  if (nameManuallyEdited.value || typeof val !== 'string') return
  const segments = val.split('/').filter(Boolean)
  name.value = segments.length > 0 ? segments[segments.length - 1] : ''
})

// Pre-fill path when dialog opens
watch(open, (isOpen) => {
  if (isOpen && !path.value) {
    const prefill = lastParent.value || defaultRoot.value
    if (prefill) {
      path.value = `${prefill}/`
    }
  }
})

function onNameInput() {
  nameManuallyEdited.value = true
}

async function submit() {
  // On submit, take the actual DOM value (which may include completion)
  const el = getInputEl()
  const submitPath = el?.value?.trim() || String(path.value).trim()
  if (!submitPath) return

  path.value = submitPath
  loading.value = true
  try {
    await repositoryStore.open(submitPath, name.value.trim() || undefined)
    saveLastParent(submitPath)
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
            v-model="path"
            :icon="pathIcon"
            :loading="pathLoading"
            placeholder="/path/to/repository"
            autofocus
            :color="isGitRepo ? 'success' : undefined"
            :highlight="isGitRepo"
            :ui="{ leadingIcon: isGitRepo ? 'text-success-500' : '' }"
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
            :disabled="!String(path).trim()"
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
          v-model="path"
          :icon="pathIcon"
          :loading="pathLoading"
          placeholder="/path/to/repository"
          autofocus
          :color="isGitRepo ? 'success' : undefined"
          :highlight="isGitRepo"
          :ui="{ leadingIcon: isGitRepo ? 'text-success-500' : '' }"
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
          :disabled="!String(path).trim()"
        />
      </div>
    </form>
  </div>
</template>
