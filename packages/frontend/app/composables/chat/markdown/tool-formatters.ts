import { buildUnifiedDiff } from './build-unified-diff'
import { detectLangFromPath } from './detect-lang'

function fence(lang: string, body: string): string {
  return '```' + lang + '\n' + body + '\n```'
}

function looksLikeJson(s: string): boolean {
  const trimmed = s.trim()
  if (!trimmed) return false
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function toJsonFence(value: unknown): string {
  return fence('json', JSON.stringify(value, null, 2))
}

export function formatToolInput(name: string | undefined, input: unknown): string {
  if (input === undefined || input === null) return ''
  const tool = name ?? ''

  if (typeof input !== 'object') return toJsonFence(input)
  const obj = input as Record<string, unknown>

  if (tool === 'Bash' && 'command' in obj) {
    return fence('bash', String(obj.command ?? ''))
  }

  if (tool === 'Edit' && 'file_path' in obj) {
    const diff = buildUnifiedDiff(
      String(obj.old_string ?? ''),
      String(obj.new_string ?? ''),
      String(obj.file_path),
    )
    return fence('diff', diff)
  }

  if (tool === 'Write' && 'file_path' in obj && 'content' in obj) {
    const lang = detectLangFromPath(String(obj.file_path))
    return fence(lang, String(obj.content ?? ''))
  }

  if (tool === 'Read' && 'file_path' in obj) {
    return fence('', String(obj.file_path))
  }

  return toJsonFence(input)
}

export function formatToolOutput(
  name: string | undefined,
  content: unknown,
  input?: unknown,
): string {
  if (content === undefined || content === null) return ''
  const tool = name ?? ''

  if (typeof content === 'string') {
    if (tool === 'Bash') {
      if (looksLikeJson(content)) return fence('json', content.trim())
      return fence('bash', content)
    }
    if (tool === 'Read' && typeof input === 'object' && input && 'file_path' in (input as object)) {
      const lang = detectLangFromPath(String((input as { file_path: unknown }).file_path))
      return fence(lang, content)
    }
    if (looksLikeJson(content)) return fence('json', content.trim())
    return fence('', content)
  }

  return toJsonFence(content)
}
