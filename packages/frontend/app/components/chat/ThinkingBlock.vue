<script setup lang="ts">

defineProps<{
  content: string
  streaming?: boolean
}>()
</script>

<template>
  <UChatReasoning
    :text="content"
    :streaming="streaming"
    icon="i-lucide-brain"
  />
</template>
