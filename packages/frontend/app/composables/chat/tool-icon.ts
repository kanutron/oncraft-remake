export function toolIcon(name: string | undefined): string {
  switch (name) {
    case 'Read': return 'i-lucide-file-text'
    case 'Write': return 'i-lucide-file-edit'
    case 'Edit': return 'i-lucide-pencil'
    case 'MultiEdit': return 'i-lucide-pencil-ruler'
    case 'Glob': return 'i-lucide-files'
    case 'Grep': return 'i-lucide-search'
    case 'Bash': return 'i-lucide-terminal'
    case 'BashOutput': return 'i-lucide-terminal-square'
    case 'WebFetch': return 'i-lucide-globe'
    case 'WebSearch': return 'i-lucide-search-check'
    case 'TodoWrite': return 'i-lucide-list-checks'
    case 'Task': return 'i-lucide-bot'
    case 'NotebookEdit': return 'i-lucide-book-open'
    default: return 'i-lucide-wrench'
  }
}
