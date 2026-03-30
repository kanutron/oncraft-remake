<script setup lang="ts">
import type { PathTreeNode } from '~/composables/usePathBrowser'

const props = withDefaults(defineProps<{
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
const treeOpen = ref(false)

const {
  defaultRoot, lastParent, isGitRepo, listDir,
  entriesToTreeNodes, expandTilde, checkGitRepo, saveLastParent,
} = usePathBrowser()

const pathIcon = computed(() => isGitRepo.value ? 'i-simple-icons-git' : 'i-lucide-folder')

// --- Tree state ---
const treeItems = ref<PathTreeNode[]>([])
const loadedPaths = new Set<string>()

watch(treeOpen, async (isOpen) => {
  if (isOpen && treeItems.value.length === 0 && defaultRoot.value) {
    try {
      const data = await listDir(defaultRoot.value)
      treeItems.value = entriesToTreeNodes(data.entries)
      loadedPaths.add(defaultRoot.value)
    } catch {}
  }
})

function findNode(nodes: PathTreeNode[], nodePath: string): PathTreeNode | null {
  for (const node of nodes) {
    if (node.path === nodePath) return node
    if (node.children) {
      const found = findNode(node.children, nodePath)
      if (found) return found
    }
  }
  return null
}

function onTreeToggle(_e: unknown, item: PathTreeNode) {
  if (loadedPaths.has(item.path)) return
  loadedPaths.add(item.path)

  listDir(item.path)
    .then((data) => {
      const node = findNode(treeItems.value, item.path)
      if (node) node.children = entriesToTreeNodes(data.entries)
    })
    .catch(() => {
      const node = findNode(treeItems.value, item.path)
      if (node) node.children = []
    })
}

function onTreeSelect(_e: unknown, item: PathTreeNode) {
  if (!item.isGitRepo) return
  path.value = item.path
  isGitRepo.value = true
  treeOpen.value = false
}

function getTreeKey(item: PathTreeNode) {
  return item.path
}

// --- Path field ---
watch(path, (val) => {
  if (typeof val !== 'string') return
  checkGitRepo(val)
  if (nameManuallyEdited.value) return
  const segments = val.split('/').filter(Boolean)
  name.value = segments.length > 0 ? segments[segments.length - 1] : ''
})

watch(open, (isOpen) => {
  if (isOpen && !path.value) {
    const prefill = lastParent.value || defaultRoot.value
    if (prefill) path.value = `${prefill}/`
  }
})

function onNameInput() {
  nameManuallyEdited.value = true
}

async function submit() {
  const finalPath = expandTilde(path.value.trim())
  if (!finalPath) return

  loading.value = true
  try {
    await repositoryStore.open(finalPath, name.value.trim() || undefined)
    saveLastParent(finalPath)
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
  <!-- Modal mode -->
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
          <div class="flex items-center gap-1">
            <UInput
              v-model="path"
              :icon="pathIcon"
              placeholder="/path/to/repository"
              autofocus
              class="flex-1"
              :color="isGitRepo ? 'success' : undefined"
              :highlight="isGitRepo"
              :ui="{ leadingIcon: isGitRepo ? 'text-success-500' : '' }"
            />
            <UPopover v-model:open="treeOpen">
              <UButton
                icon="i-lucide-folder-tree"
                color="neutral"
                variant="outline"
              />
              <template #content>
                <div class="p-2 w-80 max-h-80 overflow-y-auto">
                  <UTree
                    :items="treeItems"
                    :get-key="getTreeKey"
                    :on-toggle="onTreeToggle"
                    :on-select="onTreeSelect"
                    color="neutral"
                    size="sm"
                  />
                </div>
              </template>
            </UPopover>
          </div>
          <span class="text-xs text-neutral-400 dark:text-neutral-500">Browse or paste a path to a git repository</span>
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
          <UButton label="Cancel" color="neutral" variant="ghost" @click="cancel" />
          <UButton label="Add" type="submit" :loading="loading" :disabled="!path.trim()" />
        </div>
      </form>
    </template>
  </UModal>

  <!-- Inline mode -->
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
        <div class="flex items-center gap-1">
          <UInput
            v-model="path"
            :icon="pathIcon"
            placeholder="/path/to/repository"
            autofocus
            class="flex-1"
            :color="isGitRepo ? 'success' : undefined"
            :highlight="isGitRepo"
            :ui="{ leadingIcon: isGitRepo ? 'text-success-500' : '' }"
          />
          <UPopover v-model:open="treeOpen">
            <UButton
              icon="i-lucide-folder-tree"
              color="neutral"
              variant="outline"
            />
            <template #content>
              <div class="p-2 w-80 max-h-80 overflow-y-auto">
                <UTree
                  :items="treeItems"
                  :get-key="getTreeKey"
                  :on-toggle="onTreeToggle"
                  :on-select="onTreeSelect"
                  color="neutral"
                  size="sm"
                />
              </div>
            </template>
          </UPopover>
        </div>
        <span class="text-xs text-neutral-400 dark:text-neutral-500">Browse or paste a path to a git repository</span>
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
        <UButton label="Add Repository" type="submit" :loading="loading" :disabled="!path.trim()" />
      </div>
    </form>
  </div>
</template>
