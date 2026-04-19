<script setup lang="ts">
const props = defineProps<{ source: string }>()
const container = ref<HTMLElement | null>(null)
const svg = ref<string>('')

onMounted(async () => {
  const mermaid = (await import('mermaid')).default
  mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' })
  try {
    const id = 'm-' + Math.random().toString(36).slice(2)
    const { svg: rendered } = await mermaid.render(id, props.source)
    svg.value = rendered
  } catch (err) {
    svg.value = `<pre class="text-xs text-red-500">${String(err)}</pre>`
  }
})
</script>

<template>
  <div ref="container" data-mermaid class="my-2 flex justify-center" v-html="svg" />
</template>
