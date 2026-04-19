<script setup lang="ts">
import MermaidBlock from '~/components/chat/MermaidBlock.vue'
import CodeCollapsible from '~/components/chat/CodeCollapsible.vue'

const props = defineProps<{ source: string }>()
const { render } = useMarkdown()
const html = computed(() => render(props.source ?? ''))

type Segment =
  | { kind: 'html'; html: string }
  | { kind: 'mermaid'; source: string }
  | { kind: 'collapsible'; html: string; lineCount: number }

const COLLAPSE_THRESHOLD = 20

const segments = computed<Segment[]>(() => {
  const out: Segment[] = []
  const doc = new DOMParser().parseFromString(`<div>${html.value}</div>`, 'text/html')
  const root = doc.body.firstElementChild!
  const mermaidEls = Array.from(root.querySelectorAll('.mermaid-src'))
  const longPres = Array.from(root.querySelectorAll('pre')).filter((pre) => {
    const txt = pre.textContent ?? ''
    return txt.split('\n').length > COLLAPSE_THRESHOLD
  })
  const replaced = new Map<Element, { marker: string; seg: Segment }>()

  for (const el of mermaidEls) {
    const marker = `@@M_${Math.random().toString(36).slice(2)}@@`
    const src = el.getAttribute('data-mermaid-src') ?? ''
    replaced.set(el, { marker, seg: { kind: 'mermaid', source: decodeHtml(src) } })
  }
  for (const el of longPres) {
    if (replaced.has(el)) continue
    const marker = `@@C_${Math.random().toString(36).slice(2)}@@`
    const inner = el.outerHTML
    const lc = (el.textContent ?? '').split('\n').length
    replaced.set(el, { marker, seg: { kind: 'collapsible', html: inner, lineCount: lc } })
  }

  let current = root.innerHTML
  for (const [el, info] of replaced) {
    current = current.replace(el.outerHTML, info.marker)
  }

  const markerList = Array.from(replaced.values()).map(v => v)
  markerList.sort((a, b) => current.indexOf(a.marker) - current.indexOf(b.marker))

  let cursor = 0
  for (const { marker, seg } of markerList) {
    const idx = current.indexOf(marker, cursor)
    if (idx < 0) continue
    const before = current.slice(cursor, idx)
    if (before) out.push({ kind: 'html', html: before })
    out.push(seg)
    cursor = idx + marker.length
  }
  const tail = current.slice(cursor)
  if (tail) out.push({ kind: 'html', html: tail })
  return out.length ? out : [{ kind: 'html', html: html.value }]
})

function decodeHtml(s: string): string {
  const t = document.createElement('textarea')
  t.innerHTML = s
  return t.value
}
</script>

<template>
  <div class="prose prose-sm dark:prose-invert max-w-none wrap-break-word">
    <template v-for="(seg, i) in segments" :key="i">
      <div v-if="seg.kind === 'html'" v-html="seg.html" />
      <MermaidBlock v-else-if="seg.kind === 'mermaid'" :source="seg.source" />
      <CodeCollapsible v-else :html="seg.html" :line-count="seg.lineCount" />
    </template>
  </div>
</template>
