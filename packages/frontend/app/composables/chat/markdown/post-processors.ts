// Matches: path/with/slashes.ext, optional :line, optional :col.
// Extensions are restricted to the ones we care about to avoid false positives.
const PATH_RE = /\b([\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|vue|py|json|ya?ml|toml|sh|md|css|html))(?::(\d+))?(?::\d+)?\b/g

const SKIP_ANCESTORS = new Set(['A', 'CODE', 'PRE'])

function walk(node: Node, fn: (text: Text) => void): void {
  if (node.nodeType === Node.TEXT_NODE) {
    fn(node as Text)
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  if (SKIP_ANCESTORS.has((node as Element).tagName)) return
  for (const child of Array.from(node.childNodes)) walk(child, fn)
}

function replaceTextWithHtml(textNode: Text, html: string): void {
  const tmp = document.createElement('span')
  tmp.innerHTML = html
  const frag = document.createDocumentFragment()
  while (tmp.firstChild) frag.appendChild(tmp.firstChild)
  textNode.parentNode!.replaceChild(frag, textNode)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function linkifyFilePaths(html: string): string {
  if (!html) return html
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild!
  walk(root, (text) => {
    const str = text.data
    if (!PATH_RE.test(str)) { PATH_RE.lastIndex = 0; return }
    PATH_RE.lastIndex = 0
    const replaced = str.replace(PATH_RE, (match, path: string, line?: string) => {
      const href = line ? `${path}#L${line}` : path
      return `<a href="${escapeHtml(href)}">${escapeHtml(match)}</a>`
    })
    if (replaced !== str) replaceTextWithHtml(text, replaced)
  })
  return root.innerHTML
}

const JS_FRAME_RE = /^(\s*at\s+[^\n]*\([\w./-]+\.\w+:\d+:\d+\))$/gm
const PY_FRAME_RE = /^(\s*File\s+"[^"]+",\s*line\s+\d+(?:,\s*in\s+[^\n]+)?)$/gm

// Single-line (non-multiline) versions used for matching a shiki `.line` element's textContent.
const JS_FRAME_LINE_RE = /^\s*at\s+[^\n]*\([\w./-]+\.\w+:\d+:\d+\)\s*$/
const PY_FRAME_LINE_RE = /^\s*File\s+"[^"]+",\s*line\s+\d+(?:,\s*in\s+[^\n]+)?\s*$/

function isStackFrameLine(text: string): boolean {
  return JS_FRAME_LINE_RE.test(text) || PY_FRAME_LINE_RE.test(text)
}

export function formatStackTraces(html: string): string {
  if (!html) return html

  // First: regex pass — catches plain text inside <pre><code> that hasn't been
  // split into per-line spans (i.e. HTML that never went through shiki).
  let out = html
    .replace(JS_FRAME_RE, '<span class="stack-frame">$1</span>')
    .replace(PY_FRAME_RE, '<span class="stack-frame">$1</span>')

  // Second: DOM pass — shiki wraps each rendered line as
  // `<span class="line"><span>...</span></span>`, so the anchored regex above
  // never matches. Walk `.line` elements and tag the ones whose textContent
  // matches a stack-frame pattern.
  if (typeof DOMParser === 'undefined') return out
  const doc = new DOMParser().parseFromString(`<div>${out}</div>`, 'text/html')
  const root = doc.body.firstElementChild
  if (!root) return out
  const lines = root.querySelectorAll('span.line')
  let mutated = false
  for (const line of Array.from(lines)) {
    const text = line.textContent ?? ''
    if (isStackFrameLine(text)) {
      line.classList.add('stack-frame')
      mutated = true
    }
  }
  return mutated ? root.innerHTML : out
}
