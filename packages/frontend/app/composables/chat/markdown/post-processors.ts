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
