import { describe, it, expect } from 'vitest'
import { formatToolInput, formatToolOutput } from '~/composables/chat/markdown/tool-formatters'

describe('formatToolInput — Bash', () => {
  it('formats a bash command as a fenced bash block', () => {
    const md = formatToolInput('Bash', { command: 'ls -la' })
    expect(md).toBe('```bash\nls -la\n```')
  })

  it('falls back to JSON fence for unknown tools', () => {
    const md = formatToolInput('Unknown', { foo: 1 })
    expect(md).toContain('```json')
    expect(md).toContain('"foo": 1')
  })

  it('handles missing input safely', () => {
    expect(formatToolInput('Bash', undefined)).toBe('')
  })
})

describe('formatToolOutput — Bash', () => {
  it('renders plain stdout as a fenced bash block', () => {
    const md = formatToolOutput('Bash', 'total 24\ndrwx ...')
    expect(md.startsWith('```bash\n')).toBe(true)
    expect(md).toContain('total 24')
  })

  it('auto-detects JSON stdout and uses json fence', () => {
    const md = formatToolOutput('Bash', '{"ok": true, "n": 2}')
    expect(md.startsWith('```json\n')).toBe(true)
  })

  it('returns empty string for undefined output', () => {
    expect(formatToolOutput('Bash', undefined)).toBe('')
  })
})

describe('formatToolOutput — default', () => {
  it('pretty-prints object results as json', () => {
    const md = formatToolOutput('WebSearch', { results: ['a', 'b'] })
    expect(md).toContain('```json')
    expect(md).toContain('"results"')
  })

  it('renders string results as plain code', () => {
    const md = formatToolOutput('WebFetch', 'raw text')
    expect(md).toContain('```\nraw text\n```')
  })
})

describe('formatToolInput — Edit', () => {
  it('produces a unified diff fenced as diff', () => {
    const md = formatToolInput('Edit', {
      file_path: 'src/foo.ts',
      old_string: 'a\nb\nc',
      new_string: 'a\nB\nc',
    })
    expect(md).toContain('```diff')
    expect(md).toContain('-b')
    expect(md).toContain('+B')
    expect(md).toContain('src/foo.ts')
  })
})

describe('formatToolInput — Write', () => {
  it('renders content in a fenced block using language from extension', () => {
    const md = formatToolInput('Write', {
      file_path: 'src/x.ts',
      content: 'export const x = 1',
    })
    expect(md.startsWith('```ts\n')).toBe(true)
    expect(md).toContain('export const x = 1')
  })
})

describe('formatToolOutput — Read', () => {
  it('renders Read content using language from file_path in tool input', () => {
    const md = formatToolOutput('Read', 'const x = 1\n', { file_path: 'a.ts' })
    expect(md.startsWith('```ts\n')).toBe(true)
  })
})
