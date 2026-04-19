<script setup lang="ts">
const THRESHOLD = 20

const props = defineProps<{ html: string; lineCount: number }>()
const open = ref(props.lineCount <= THRESHOLD)
const collapsed = computed(() => !open.value)
</script>

<template>
  <div :data-collapsed="collapsed ? 'true' : 'false'" class="my-2">
    <div v-if="open" v-html="html" />
    <UButton
      v-else
      variant="subtle"
      size="xs"
      :label="`Show ${lineCount} lines`"
      icon="i-lucide-chevron-down"
      class="cursor-pointer"
      @click="open = true"
    />
  </div>
</template>
