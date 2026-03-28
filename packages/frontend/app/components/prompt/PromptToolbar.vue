<script setup lang="ts">
const model = ref('sonnet')
const effort = ref('medium')

const modelItems = [
  { label: 'Sonnet', value: 'sonnet' },
  { label: 'Opus', value: 'opus' },
  { label: 'Haiku', value: 'haiku' },
]

const effortItems = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
]

// Expose values so PromptBox can read them
defineExpose({ model, effort })
</script>

<template>
  <div class="flex items-center gap-2 px-4 py-1.5">
    <USelect
      v-model="model"
      :items="modelItems"
      placeholder="Model"
      size="xs"
      variant="ghost"
      icon="i-lucide-cpu"
      class="w-28"
    />
    <USelect
      v-model="effort"
      :items="effortItems"
      placeholder="Effort"
      size="xs"
      variant="ghost"
      icon="i-lucide-gauge"
      class="w-28"
    />
  </div>
</template>
