<script setup lang="ts">
const props = defineProps<{ source: string }>()
const { render } = useMarkdown()
const html = computed(() => render(props.source ?? ''))
</script>

<template>
  <div
    class="prose prose-sm dark:prose-invert max-w-none break-words"
    v-html="html"
  />
</template>
