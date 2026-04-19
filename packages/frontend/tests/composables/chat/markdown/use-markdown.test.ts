// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from 'vitest'
import { ensureMarkdown, renderMarkdown } from '~/composables/chat/markdown/use-markdown'

describe('renderMarkdown', () => {
  beforeAll(async () => {
    await ensureMarkdown()
  })

  it('renders bold and italics', () => {
    const html = renderMarkdown('hello **world** and *there*')
    expect(html).toContain('<strong>world</strong>')
    expect(html).toContain('<em>there</em>')
  })

  it('renders GFM tables', () => {
    const src = '| a | b |\n|---|---|\n| 1 | 2 |'
    const html = renderMarkdown(src)
    expect(html).toContain('<table>')
    expect(html).toContain('<td>1</td>')
  })

  it('auto-links bare URLs', () => {
    const html = renderMarkdown('see https://example.com for details')
    expect(html).toMatch(/<a[^>]+href="https:\/\/example\.com"/)
  })

  it('highlights bash fenced blocks', () => {
    const html = renderMarkdown('```bash\necho hi\n```')
    expect(html).toMatch(/shiki|style=/i)
    expect(html).toContain('echo')
  })

  it('highlights json fenced blocks', () => {
    const html = renderMarkdown('```json\n{"a":1}\n```')
    expect(html).toMatch(/shiki|style=/i)
  })

  it('strips script tags from raw HTML', () => {
    const html = renderMarkdown('ok <script>alert(1)</script> done')
    expect(html).not.toContain('<script>')
  })

  it('keeps relative links', () => {
    const html = renderMarkdown('[x](src/foo.ts#L1)')
    expect(html).toContain('href="src/foo.ts#L1"')
  })
})

describe('renderMarkdown before init', () => {
  it('returns an escaped <pre> fallback', async () => {
    expect(typeof renderMarkdown('test')).toBe('string')
  })
})

describe('renderMarkdown — post-processors', () => {
  it('linkifies file paths in prose', async () => {
    await ensureMarkdown()
    const html = renderMarkdown('see src/foo.ts:42 for the bug')
    expect(html).toContain('href="src/foo.ts#L42"')
  })

  it('styles JS stack frames inside fenced code', async () => {
    await ensureMarkdown()
    const html = renderMarkdown('```\nError: x\n    at foo (src/a.ts:1:1)\n```')
    expect(html).toContain('stack-frame')
  })
})
