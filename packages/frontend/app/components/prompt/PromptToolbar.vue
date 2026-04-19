<script setup lang="ts">
const props = defineProps<{ sessionId: string }>()

const caps = useCapabilitiesStore()
const sessions = useSessionStore()

onMounted(() => { void caps.load() })

const session = computed(() => sessions.sessions.get(props.sessionId) ?? null)

const model          = ref<string | null>(session.value?.preferredModel ?? null)
const effort         = ref<string | null>(session.value?.preferredEffort ?? null)
const permissionMode = ref<string | null>(session.value?.preferredPermissionMode ?? null)
const thinkingMode   = ref<'off' | 'adaptive' | 'fixed' | null>(session.value?.thinkingMode ?? null)
const thinkingBudget = ref<number | null>(session.value?.thinkingBudget ?? null)

watch(
  () => session.value,
  s => {
    if (!s) return
    model.value          = s.preferredModel
    effort.value         = s.preferredEffort
    permissionMode.value = s.preferredPermissionMode
    thinkingMode.value   = s.thinkingMode
    thinkingBudget.value = s.thinkingBudget
  },
  { immediate: true },
)

const modelItems = computed(() =>
  caps.models.map(m => ({ label: m.label, value: m.value })),
)

const effortItems = computed(() =>
  caps.effortLevels.map(e => ({
    label: e.label,
    value: e.value,
    disabled: Array.isArray(e.supportedModels)
      && !!model.value
      && !e.supportedModels.includes(model.value),
  })),
)

const permissionItems = computed(() =>
  caps.permissionModes.map(p => ({
    label: p.label,
    value: p.value,
    dangerous: !!p.dangerous,
  })),
)

const thinkingItems = computed(() =>
  caps.thinkingModes.map(t => ({ label: t.label, value: t.value })),
)

// --- persistence ---
let pending: ReturnType<typeof setTimeout> | null = null
function debouncedPersist() {
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    void sessions.updatePreferences(props.sessionId, {
      preferredModel: model.value,
      preferredEffort: effort.value,
      preferredPermissionMode: permissionMode.value,
      thinkingMode: thinkingMode.value,
      thinkingBudget: thinkingBudget.value,
    })
  }, 500)
}
onBeforeUnmount(() => {
  if (pending) {
    clearTimeout(pending)
    pending = null
  }
})

async function setModel(v: string) { model.value = v; debouncedPersist() }
async function setEffort(v: string) { effort.value = v; debouncedPersist() }
async function setPermissionMode(v: string) { permissionMode.value = v; debouncedPersist() }
async function setThinkingMode(v: 'off' | 'adaptive' | 'fixed') {
  thinkingMode.value = v
  if (v === 'fixed' && thinkingBudget.value == null) {
    thinkingBudget.value = caps.defaultThinkingBudget
  }
  debouncedPersist()
}
async function setThinkingBudget(v: number) { thinkingBudget.value = v; debouncedPersist() }

defineExpose({
  model, effort, permissionMode, thinkingMode, thinkingBudget,
  modelItems, effortItems, permissionItems, thinkingItems,
  setModel, setEffort, setPermissionMode, setThinkingMode, setThinkingBudget,
})
</script>

<template>
  <div class="flex items-center gap-2 px-4 py-1.5">
    <USelect
      :model-value="model ?? undefined"
      :items="modelItems"
      placeholder="Model"
      size="xs"
      variant="ghost"
      icon="i-lucide-cpu"
      class="w-28"
      @update:model-value="setModel"
    />
    <USelect
      :model-value="effort ?? undefined"
      :items="effortItems"
      placeholder="Effort"
      size="xs"
      variant="ghost"
      icon="i-lucide-gauge"
      class="w-28"
      @update:model-value="setEffort"
    />
    <USelect
      :model-value="permissionMode ?? undefined"
      :items="permissionItems"
      placeholder="Mode"
      size="xs"
      variant="ghost"
      icon="i-lucide-shield"
      class="w-32"
      @update:model-value="setPermissionMode"
    >
      <template #item-label="{ item }">
        <span :class="item.dangerous ? 'text-red-600 dark:text-red-400' : ''">{{ item.label }}</span>
      </template>
    </USelect>
    <USelect
      :model-value="thinkingMode ?? undefined"
      :items="thinkingItems"
      placeholder="Thinking"
      size="xs"
      variant="ghost"
      icon="i-lucide-brain"
      class="w-32"
      @update:model-value="setThinkingMode"
    />
    <UInput
      v-if="thinkingMode === 'fixed'"
      data-test="thinking-budget"
      :model-value="thinkingBudget ?? caps.defaultThinkingBudget"
      type="number"
      :min="1024"
      :step="1024"
      size="xs"
      variant="ghost"
      class="w-24"
      placeholder="Budget"
      @update:model-value="setThinkingBudget"
    />
  </div>
</template>
