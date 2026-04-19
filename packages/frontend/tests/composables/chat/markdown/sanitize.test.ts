// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { sanitize } from '~/composables/chat/markdown/sanitize'

describe('sanitize', () => {
  it('strips script tags', () => {
    const dirty = '<p>ok</p><script>alert(1)</script>'
    expect(sanitize(dirty)).toBe('<p>ok</p>')
  })

  it('strips javascript: URIs', () => {
    const dirty = '<a href="javascript:alert(1)">x</a>'
    expect(sanitize(dirty)).not.toContain('javascript:')
  })

  it('strips inline event handlers', () => {
    const dirty = '<img src="x" onerror="alert(1)">'
    expect(sanitize(dirty)).not.toContain('onerror')
  })

  it('keeps style attribute on code spans (shiki needs it)', () => {
    const dirty = '<pre><code><span style="color:#abc">x</span></code></pre>'
    expect(sanitize(dirty)).toContain('style="color:#abc"')
  })

  it('keeps details/summary', () => {
    const dirty = '<details><summary>hi</summary>body</details>'
    const out = sanitize(dirty)
    expect(out).toContain('<details>')
    expect(out).toContain('<summary>')
  })

  it('keeps tables', () => {
    const dirty = '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>'
    expect(sanitize(dirty)).toContain('<table>')
  })

  it('keeps relative hrefs', () => {
    const dirty = '<a href="src/foo.ts#L10">foo</a>'
    expect(sanitize(dirty)).toContain('href="src/foo.ts#L10"')
  })

  it('keeps images with https src', () => {
    const dirty = '<img src="https://example.com/a.png" alt="a">'
    expect(sanitize(dirty)).toContain('<img')
  })
})
