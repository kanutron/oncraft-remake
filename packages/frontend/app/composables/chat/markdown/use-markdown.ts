import MarkdownIt from 'markdown-it'
import Shiki from '@shikijs/markdown-it'
import { sanitize } from './sanitize'
import { linkifyFilePaths, formatStackTraces } from './post-processors'

const SHIKI_LANGS = [
  'bash', 'shell', 'sh', 'zsh',
  'json', 'yaml', 'toml',
  'ts', 'tsx', 'js', 'jsx',
  'vue', 'html', 'css',
  'python', 'diff', 'md',
] as const

let mdInstance: MarkdownIt | null = null
let initPromise: Promise<MarkdownIt> | null = null

async function initMarkdown(): Promise<MarkdownIt> {
  const md = new MarkdownIt({ html: true, linkify: true, breaks: false })
  const shikiPlugin = await Shiki({
    themes: { light: 'github-light', dark: 'github-dark' },
    langs: [...SHIKI_LANGS],
  })
  md.use(shikiPlugin)
  mdInstance = md
  return md
}

/** Await before calling `renderMarkdown` if you want the highlighted output in the first render. */
export function ensureMarkdown(): Promise<MarkdownIt> {
  if (mdInstance) return Promise.resolve(mdInstance)
  if (!initPromise) initPromise = initMarkdown()
  return initPromise
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fallback(source: string): string {
  return `<pre class="whitespace-pre-wrap"><code>${escapeHtml(source)}</code></pre>`
}

function hasDomParser(): boolean {
  return typeof DOMParser !== 'undefined'
}

/** Synchronous render. Returns fallback `<pre>` if shiki is still initializing. */
export function renderMarkdown(source: string): string {
  if (!mdInstance) {
    // Kick off init so future calls succeed, but don't block.
    void ensureMarkdown()
    return fallback(source)
  }
  const rendered = mdInstance.render(source)
  const clean = sanitize(rendered)
  const withStacks = formatStackTraces(clean)
  const withLinks = hasDomParser() ? linkifyFilePaths(withStacks) : withStacks
  return withLinks
}

/**
 * Composable entry point for components. Tracks a reactive `ready` flag and
 * bumps an internal version so any `render()` callsite re-runs once shiki is
 * initialized.
 */
export function useMarkdown() {
  const ready = ref(!!mdInstance)
  const version = ref(0)
  if (!mdInstance) {
    ensureMarkdown().then(() => {
      ready.value = true
      version.value++
    })
  }
  const render = (source: string) => {
    // Touch `version` so the computed re-runs when init flips.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    version.value
    return renderMarkdown(source)
  }
  return { ready, render }
}
