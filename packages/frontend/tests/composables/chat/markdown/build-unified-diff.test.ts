import { describe, it, expect } from 'vitest'
import { buildUnifiedDiff } from '~/composables/chat/markdown/build-unified-diff'

describe('buildUnifiedDiff', () => {
  it('produces a unified diff for a single-line change', () => {
    const out = buildUnifiedDiff('foo\nbar\nbaz', 'foo\nqux\nbaz', 'file.ts')
    expect(out).toContain('--- a/file.ts')
    expect(out).toContain('+++ b/file.ts')
    expect(out).toContain('-bar')
    expect(out).toContain('+qux')
  })

  it('handles pure additions', () => {
    const out = buildUnifiedDiff('foo', 'foo\nbar', 'x.md')
    expect(out).toContain('+bar')
  })

  it('handles pure deletions', () => {
    const out = buildUnifiedDiff('foo\nbar', 'foo', 'x.md')
    expect(out).toContain('-bar')
  })

  it('handles identical inputs', () => {
    const out = buildUnifiedDiff('same', 'same', 'x.md')
    expect(out).toContain('--- a/x.md')
  })
})
