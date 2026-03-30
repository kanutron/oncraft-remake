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

const { items: pathItems, loading: pathLoading, isGitRepo, lastParent, saveLastParent, resolveSelection, defaultRoot } = usePathSuggestions(path)

const pathIcon = computed(() => isGitRepo.value ? 'i-simple-icons-git' : 'i-lucide-folder')

// Tab-completion: track highlighted item and select on Tab
const highlightedValue = ref<string | null>(null)

function onHighlight(payload: { value: string } | undefined) {
  highlightedValue.value = payload?.value ?? null
}

function onTabKey(e: KeyboardEvent) {
  if (highlightedValue.value) {
    e.preventDefault()
    onPathUpdate(highlightedValue.value)
  }
}

// Auto-fill name from last path segment
watch(path, (val) => {
  if (nameManuallyEdited.value) return
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

// Handle path input updates — when user selects from dropdown, append trailing /
function onPathUpdate(val: string) {
  const resolved = resolveSelection(val)
  path.value = resolved ?? val
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
          <UInputMenu
            :model-value="path"
            autocomplete
            :items="pathItems"
            :loading="pathLoading"
            :icon="pathIcon"
            ignore-filter
            value-key="value"
            placeholder="/path/to/repository"
            autofocus
            :content="{ hideWhenEmpty: true }"
            :ui="{ base: '[direction:rtl] text-left' }"
            @update:model-value="onPathUpdate"
            @highlight="onHighlight"
            @keydown.tab="onTabKey"
          />
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
        <UInputMenu
          :model-value="path"
          autocomplete
          :items="pathItems"
          :loading="pathLoading"
          :icon="pathIcon"
          ignore-filter
          value-key="value"
          placeholder="/path/to/repository"
          autofocus
          :content="{ hideWhenEmpty: true }"
          @update:model-value="onPathUpdate"
          @highlight="onHighlight"
          @keydown.tab="onTabKey"
        />
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
