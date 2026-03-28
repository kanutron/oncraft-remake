// Mirror backend types — keep in sync manually for now
// (shared package is a future optimization)

export interface Workspace {
  id: string
  path: string
  name: string
  branch?: string // only present on GET /:id
  createdAt: string
  lastOpenedAt: string
}

export interface Session {
  id: string
  workspaceId: string
  claudeSessionId: string | null
  name: string
  sourceBranch: string
  workBranch: string | null
  targetBranch: string
  worktreePath: string | null
  state: SessionState
  createdAt: string
  lastActivityAt: string
  costUsd: number
  inputTokens: number
  outputTokens: number
}

export type SessionState = 'idle' | 'starting' | 'active' | 'stopped' | 'error' | 'completed'

// Chat message — raw SDK message with our metadata
export interface ChatMessage {
  id: string
  sessionId: string
  timestamp: string
  raw: Record<string, unknown> // raw SDK message
}
