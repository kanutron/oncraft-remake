<script setup lang="ts">
import MermaidBlock from '~/components/chat/MermaidBlock.vue'

const props = defineProps<{ source: string }>()
const { render } = useMarkdown()
const html = computed(() => render(props.source ?? ''))

type Segment = { kind: 'html'; html: string } | { kind: 'mermaid'; source: string }

const segments = computed<Segment[]>(() => {
  const out: Segment[] = []
  const doc = new DOMParser().parseFromString(`<div>${html.value}</div>`, 'text/html')
  const root = doc.body.firstElementChild!
  const placeholders = Array.from(root.querySelectorAll('.mermaid-src'))
  if (placeholders.length === 0) {
    out.push({ kind: 'html', html: html.value })
    return out
  }
  let current = root.innerHTML
  for (const el of placeholders) {
    const marker = `@@MERMAID_${Math.random().toString(36).slice(2)}@@`
    const src = el.getAttribute('data-mermaid-src') ?? ''
    const outer = el.outerHTML
    current = current.replace(outer, marker)
    const [before, rest] = current.split(marker)
    out.push({ kind: 'html', html: before ?? '' })
    out.push({ kind: 'mermaid', source: decodeHtml(src) })
    current = rest ?? ''
  }
  if (current) out.push({ kind: 'html', html: current })
  return out
})

function decodeHtml(s: string): string {
  const t = document.createElement('textarea')
  t.innerHTML = s
  return t.value
}
</script>

<template>
  <div class="prose prose-sm dark:prose-invert max-w-none break-words">
    <template v-for="(seg, i) in segments" :key="i">
      <div v-if="seg.kind === 'html'" v-html="seg.html" />
      <MermaidBlock v-else :source="seg.source" />
    </template>
  </div>
</template>
