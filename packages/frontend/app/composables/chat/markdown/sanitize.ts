import DOMPurify from 'dompurify'

const ALLOWED_TAGS = [
  'a', 'p', 'br', 'hr', 'strong', 'em', 'del', 's', 'u', 'kbd', 'mark', 'small', 'sup', 'sub',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote',
  'pre', 'code', 'span', 'div',
  'details', 'summary',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'img',
]

const ALLOWED_ATTR = [
  'href', 'title', 'alt', 'src', 'name', 'id',
  'class', 'style',
  'open',
  'colspan', 'rowspan',
  'data-lang', 'data-line', 'data-file',
  'data-mermaid-src',
]

const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto):|[^:]*(?:[/?#]|$))/i

export function sanitize(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
  })
}
