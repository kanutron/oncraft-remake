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

  if (tool === 'Bash' && typeof input === 'object' && input && 'command' in input) {
    const cmd = String((input as { command: unknown }).command ?? '')
    return fence('bash', cmd)
  }

  // Default: JSON-dump the input
  return toJsonFence(input)
}

export function formatToolOutput(name: string | undefined, content: unknown): string {
  if (content === undefined || content === null) return ''
  const tool = name ?? ''

  if (typeof content === 'string') {
    if (tool === 'Bash') {
      if (looksLikeJson(content)) return fence('json', content.trim())
      return fence('bash', content)
    }
    if (looksLikeJson(content)) return fence('json', content.trim())
    return fence('', content)
  }

  return toJsonFence(content)
}
