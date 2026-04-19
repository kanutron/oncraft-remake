// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { linkifyFilePaths } from '~/composables/chat/markdown/post-processors'

describe('linkifyFilePaths', () => {
  it('linkifies path:line in plain text', () => {
    const out = linkifyFilePaths('see src/foo.ts:42 for context')
    expect(out).toContain('<a href="src/foo.ts#L42">src/foo.ts:42</a>')
  })

  it('linkifies bare paths with known extensions', () => {
    const out = linkifyFilePaths('edited src/a.vue today')
    expect(out).toContain('<a href="src/a.vue">src/a.vue</a>')
  })

  it('does not linkify inside <code> blocks', () => {
    const out = linkifyFilePaths('<code>src/foo.ts:1</code>')
    expect(out).toBe('<code>src/foo.ts:1</code>')
  })

  it('does not double-linkify existing anchors', () => {
    const out = linkifyFilePaths('<a href="x">src/foo.ts:1</a>')
    expect(out).toBe('<a href="x">src/foo.ts:1</a>')
  })

  it('handles line+col', () => {
    const out = linkifyFilePaths('src/x.ts:10:5')
    expect(out).toContain('href="src/x.ts#L10"')
  })
})

import { formatStackTraces } from '~/composables/chat/markdown/post-processors'

describe('formatStackTraces', () => {
  it('wraps JS "at fn (file.ts:10:5)" frames', () => {
    const input = '<pre><code>Error: boom\n    at foo (src/a.ts:10:5)\n    at bar (src/b.ts:3:1)</code></pre>'
    const out = formatStackTraces(input)
    expect(out).toContain('class="stack-frame"')
    expect(out).toContain('src/a.ts')
  })

  it('wraps Python "File ..., line N" frames', () => {
    const input = '<pre><code>Traceback (most recent call last):\n  File "app.py", line 12, in <module>\n    x()</code></pre>'
    const out = formatStackTraces(input)
    expect(out).toContain('class="stack-frame"')
    expect(out).toContain('app.py')
  })

  it('leaves unrelated text untouched', () => {
    const input = '<p>just a sentence</p>'
    expect(formatStackTraces(input)).toBe(input)
  })
})
