<script setup lang="ts">

const props = defineProps<{
  toolUse: Record<string, unknown>
}>()

const toolName = computed(() => (props.toolUse.name ?? 'Unknown tool') as string)

const toolInput = computed(() => {
  const input = props.toolUse.input
  if (!input) return ''
  return typeof input === 'string' ? input : JSON.stringify(input, null, 2)
})
</script>

<template>
  <UChatTool
    :text="toolName"
    icon="i-lucide-wrench"
    variant="inline"
  >
    <pre class="text-xs font-mono bg-neutral-100 dark:bg-neutral-900 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">{{ toolInput }}</pre>
  </UChatTool>
</template>
