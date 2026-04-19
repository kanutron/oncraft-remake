const EXT_TO_LANG: Record<string, string> = {
  ts: 'ts', tsx: 'tsx',
  js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  vue: 'vue',
  py: 'python',
  json: 'json',
  yml: 'yaml', yaml: 'yaml',
  toml: 'toml',
  sh: 'bash', bash: 'bash', zsh: 'zsh',
  md: 'md', markdown: 'md',
  html: 'html', htm: 'html',
  css: 'css',
}

export function detectLangFromPath(path: string): string {
  const base = path.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  const ext = base.slice(dot + 1).toLowerCase()
  return EXT_TO_LANG[ext] ?? ''
}
