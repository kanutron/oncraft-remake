# OnCraft Remake — Iteration 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working web tool that manages parallel Claude Code sessions across git workspaces, with explicit git context per session, transparent SDK passthrough, and real-time event streaming.

**Architecture:** Monorepo with two packages — a Bun/Fastify backend exposing REST + WebSocket APIs, and a Nuxt 4 SPA frontend. The backend spawns one bridge child process per active session (communicating via JSON-lines stdio), wraps git operations via simple-git, and watches filesystem for git state changes. The frontend renders SDK messages using NuxtUI v4 chat components.

**Tech Stack:** Bun runtime, Fastify, bun:sqlite, simple-git, chokidar, @anthropic-ai/claude-agent-sdk, Nuxt 4, NuxtUI v4, Pinia, pnpm workspaces

**Spec:** `.context/agents/spec/oncraft-remake/design.md`

---

## File Structure

### Root

```
oncraft-remake/
├── packages/
│   ├── backend/
│   └── frontend/
├── pnpm-workspace.yaml
├── package.json            # root scripts
├── Taskfile.yml            # dev, test, lint, build tasks
├── tsconfig.base.json      # shared TS config
├── .gitignore
└── AGENTS.md
```

### Backend (`packages/backend/`)

```
packages/backend/
├── src/
│   ├── server.ts                    # Fastify app setup, plugin registration, startup
│   ├── types/
│   │   └── index.ts                 # Domain model types (Workspace, Session, etc.)
│   ├── infra/
│   │   ├── store.ts                 # SQLite database, migrations, CRUD
│   │   ├── event-bus.ts             # Path-based pub/sub EventEmitter
│   │   └── git-watcher.ts           # chokidar + polling for .git/HEAD changes
│   ├── services/
│   │   ├── git.service.ts           # simple-git wrapper (branches, worktrees, merge, status)
│   │   ├── workspace.service.ts     # workspace CRUD, GitWatcher lifecycle
│   │   ├── session.service.ts       # session CRUD, ProcessManager orchestration
│   │   └── process-manager.ts       # child process spawning/lifecycle per session
│   ├── routes/
│   │   ├── workspace.routes.ts      # GET/POST/DELETE /workspaces
│   │   ├── session.routes.ts        # CRUD + send/reply/interrupt/stop/resume/history
│   │   ├── git.routes.ts            # status/branches/worktrees/checkout/merge/rebase
│   │   └── ws.routes.ts             # WebSocket upgrade + event multiplexing
│   └── bridge/
│       └── session-bridge.ts        # Standalone Bun script: SDK <-> stdin/stdout JSON-lines
├── tests/
│   ├── helpers/
│   │   ├── test-repo.ts             # Create/destroy temp git repos for testing
│   │   └── fixtures.ts              # Reusable test data factories
│   ├── infra/
│   │   ├── store.test.ts
│   │   ├── event-bus.test.ts
│   │   └── git-watcher.test.ts
│   ├── services/
│   │   ├── git.service.test.ts
│   │   ├── workspace.service.test.ts
│   │   ├── session.service.test.ts
│   │   └── process-manager.test.ts
│   ├── routes/
│   │   ├── workspace.routes.test.ts
│   │   ├── session.routes.test.ts
│   │   └── git.routes.test.ts
│   └── bridge/
│       └── session-bridge.test.ts
├── package.json
└── tsconfig.json
```

### Frontend (`packages/frontend/`)

```
packages/frontend/
├── app/
│   ├── app.vue                      # Root layout: WorkspaceTabBar + WorkspaceView
│   ├── components/
│   │   ├── workspace/
│   │   │   ├── WorkspaceTabBar.vue  # Top-level repo tabs
│   │   │   ├── WorkspaceView.vue    # Container for one workspace's sessions
│   │   │   └── WorkspaceSelector.vue # Open/add workspace dialog
│   │   ├── session/
│   │   │   ├── SessionTabBar.vue    # Session tabs within workspace
│   │   │   ├── SessionView.vue      # Container: header + chat + prompt
│   │   │   ├── SessionHeader.vue    # Branch info, state badge, metrics
│   │   │   └── NewSessionDialog.vue # Create session form
│   │   ├── chat/
│   │   │   ├── ChatHistory.vue      # Scrollable message list
│   │   │   ├── AssistantMessage.vue  # Renders assistant content blocks
│   │   │   ├── UserMessage.vue      # User-sent messages
│   │   │   ├── ToolInvocation.vue   # Collapsible tool use + result
│   │   │   ├── ToolApprovalBar.vue  # Permission prompt [Allow/Deny]
│   │   │   ├── ThinkingBlock.vue    # Collapsible extended thinking
│   │   │   ├── SystemMessage.vue    # Git warnings, state changes
│   │   │   ├── ErrorNotice.vue      # Error display
│   │   │   └── GenericMessage.vue   # Fallback for unknown message types
│   │   └── prompt/
│   │       ├── PromptBox.vue        # Input area + send button
│   │       └── PromptToolbar.vue    # Model, effort, permission selectors
│   ├── composables/
│   │   ├── useWebSocket.ts          # WebSocket connection + event dispatch
│   │   └── useMessageRegistry.ts    # SDK message type → Vue component mapping
│   ├── stores/
│   │   ├── workspace.store.ts       # Workspace CRUD, active workspace
│   │   └── session.store.ts         # Session CRUD, messages, active session per workspace
│   └── types/
│       └── index.ts                 # Frontend-specific types (re-exports backend types + UI types)
├── nuxt.config.ts
├── package.json
└── tsconfig.json
```

---

## Phase 0: Project Scaffold

### Task 0.1: Monorepo Setup

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`
- Create: `packages/backend/package.json`, `packages/backend/tsconfig.json`
- Create: `packages/frontend/package.json`, `packages/frontend/nuxt.config.ts`, `packages/frontend/tsconfig.json`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "oncraft-remake",
  "private": true,
  "scripts": {
    "dev": "task dev",
    "build": "task build",
    "test": "task test:all",
    "lint": "task lint:check"
  }
}
```

- [ ] **Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - packages/*
```

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "types": ["bun-types"]
  }
}
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
.nuxt/
.output/
*.db
*.db-journal
.env
.env.local
```

- [ ] **Step 5: Create backend package.json**

```json
{
  "name": "@oncraft/backend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/server.ts",
    "build": "bun build src/server.ts --outdir dist --target bun",
    "test": "bun test",
    "lint": "bunx biome check src/ tests/"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.76",
    "fastify": "^5.0.0",
    "@fastify/websocket": "^11.0.0",
    "@fastify/cors": "^10.0.0",
    "simple-git": "^3.27.0",
    "chokidar": "^4.0.0"
  },
  "devDependencies": {
    "bun-types": "latest",
    "@biomejs/biome": "^1.9.0"
  }
}
```

- [ ] **Step 6: Create backend tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 7: Create frontend package.json**

```json
{
  "name": "@oncraft/frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "nuxt dev",
    "build": "nuxt build",
    "test": "vitest run",
    "lint": "nuxt lint"
  },
  "dependencies": {
    "@nuxt/ui": "^3.0.0",
    "nuxt": "^4.0.0",
    "pinia": "^2.2.0"
  },
  "devDependencies": {
    "@nuxt/test-utils": "^3.15.0",
    "vitest": "^2.0.0",
    "@vue/test-utils": "^2.4.0"
  }
}
```

- [ ] **Step 8: Create frontend nuxt.config.ts**

```typescript
export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@pinia/nuxt'],
  ssr: false,
  devtools: { enabled: true },
  devServer: {
    port: 3100,
  },
  runtimeConfig: {
    public: {
      backendUrl: 'http://localhost:3101',
      wsUrl: 'ws://localhost:3101/ws',
    },
  },
})
```

- [ ] **Step 9: Create minimal frontend app.vue**

```vue
<template>
  <UApp>
    <div class="min-h-screen">
      <p>OnCraft Remake</p>
    </div>
  </UApp>
</template>
```

- [ ] **Step 10: Install dependencies**

Run: `pnpm install`
Expected: Clean install, no errors

- [ ] **Step 11: Commit scaffold**

```bash
git add -A
git commit -m "chore: scaffold monorepo with backend and frontend packages"
```

### Task 0.2: Taskfile & Dev Tooling

**Files:**
- Create: `Taskfile.yml`
- Create: `AGENTS.md`

- [ ] **Step 1: Create Taskfile.yml**

```yaml
version: '3'

tasks:
  dev:
    desc: Start backend and frontend in parallel
    deps: [dev:backend, dev:frontend]

  dev:backend:
    desc: Start backend dev server
    dir: packages/backend
    cmd: bun --watch src/server.ts

  dev:frontend:
    desc: Start frontend dev server
    dir: packages/frontend
    cmd: pnpm dev

  build:
    desc: Build all packages
    deps: [build:backend, build:frontend]

  build:backend:
    dir: packages/backend
    cmd: bun build src/server.ts --outdir dist --target bun

  build:frontend:
    dir: packages/frontend
    cmd: pnpm build

  test:all:
    desc: Run all tests
    deps: [test:backend, test:frontend]

  test:backend:
    desc: Run backend tests
    dir: packages/backend
    cmd: bun test

  test:frontend:
    desc: Run frontend tests
    dir: packages/frontend
    cmd: pnpm test

  lint:check:
    desc: Lint all packages
    deps: [lint:backend, lint:frontend]

  lint:backend:
    dir: packages/backend
    cmd: bunx biome check src/ tests/

  lint:frontend:
    dir: packages/frontend
    cmd: pnpm lint
```

- [ ] **Step 2: Create AGENTS.md**

Write AGENTS.md with:
- Repository purpose (OnCraft Remake — parallel Claude Code session manager)
- Architecture overview (Bun/Fastify backend + Nuxt SPA, monorepo)
- Operations: `task dev`, `task test:all`, `task lint:check`, `task build`
- Constraints: Bun runtime for backend, pnpm for packages, NuxtUI v4 only (no custom CSS), all specs in `.context/agents/spec/`
- Reference to design spec at `.context/agents/spec/oncraft-remake/design.md`

- [ ] **Step 3: Commit**

```bash
git add Taskfile.yml AGENTS.md
git commit -m "chore: add Taskfile and AGENTS.md"
```

### Task 0.3: Backend Server Skeleton

**Files:**
- Create: `packages/backend/src/server.ts`
- Create: `packages/backend/src/types/index.ts`

- [ ] **Step 1: Create domain types**

```typescript
// packages/backend/src/types/index.ts

export interface Workspace {
  id: string
  path: string
  name: string
  createdAt: string
  lastOpenedAt: string
}

export interface Session {
  id: string
  workspaceId: string
  claudeSessionId: string | null
  name: string
  sourceBranch: string
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

// Bridge stdin commands
export interface BridgeCommand {
  cmd: 'start' | 'reply' | 'interrupt' | 'stop' | 'loadHistory' | 'listSessions'
  [key: string]: unknown
}

// Bridge stdout events — raw SDK messages pass through, bridge adds its own types
export interface BridgeEvent {
  type: string
  [key: string]: unknown
}

// WebSocket server -> client events
export interface WSServerEvent {
  event: string
  sessionId?: string
  workspaceId?: string
  data: unknown
}

// WebSocket client -> server commands
export interface WSClientCommand {
  command: string
  sessionId?: string
  data: unknown
}

// Git state change event (emitted by GitWatcher, path-scoped)
export interface GitChangeEvent {
  path: string
  from: string
  to: string
}
```

- [ ] **Step 2: Create server skeleton**

```typescript
// packages/backend/src/server.ts
import Fastify from 'fastify'

const app = Fastify({ logger: true })

app.get('/health', async () => ({ status: 'ok' }))

const start = async () => {
  const port = Number(process.env.PORT) || 3101
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`OnCraft backend listening on port ${port}`)
}

start()
```

- [ ] **Step 3: Verify server starts**

Run: `cd packages/backend && bun src/server.ts`
Expected: Server starts on port 3101, `GET /health` returns `{"status":"ok"}`

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/
git commit -m "feat: add backend server skeleton with domain types"
```

---

## Phase 1: Backend Infrastructure

### Task 1.1: EventBus

A path-based pub/sub system. GitWatcher emits by filesystem path; services subscribe to paths they care about.

**Files:**
- Create: `packages/backend/src/infra/event-bus.ts`
- Create: `packages/backend/tests/infra/event-bus.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// packages/backend/tests/infra/event-bus.test.ts
import { describe, test, expect, mock } from 'bun:test'
import { EventBus } from '../../src/infra/event-bus'

describe('EventBus', () => {
  test('subscribes to exact path and receives events', () => {
    const bus = new EventBus()
    const handler = mock(() => {})
    bus.on('/repo/main', 'git:branch-changed', handler)
    bus.emit('/repo/main', 'git:branch-changed', { from: 'dev', to: 'main' })
    expect(handler).toHaveBeenCalledWith({ from: 'dev', to: 'main' })
  })

  test('does not receive events for different paths', () => {
    const bus = new EventBus()
    const handler = mock(() => {})
    bus.on('/repo/main', 'git:branch-changed', handler)
    bus.emit('/repo/worktree-1', 'git:branch-changed', { from: 'a', to: 'b' })
    expect(handler).not.toHaveBeenCalled()
  })

  test('does not receive events for different event types', () => {
    const bus = new EventBus()
    const handler = mock(() => {})
    bus.on('/repo/main', 'git:branch-changed', handler)
    bus.emit('/repo/main', 'git:status-changed', { files: 3 })
    expect(handler).not.toHaveBeenCalled()
  })

  test('wildcard path receives all events of a type', () => {
    const bus = new EventBus()
    const handler = mock(() => {})
    bus.on('*', 'git:branch-changed', handler)
    bus.emit('/any/path', 'git:branch-changed', { from: 'a', to: 'b' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  test('unsubscribe stops receiving events', () => {
    const bus = new EventBus()
    const handler = mock(() => {})
    const unsub = bus.on('/repo/main', 'git:branch-changed', handler)
    unsub()
    bus.emit('/repo/main', 'git:branch-changed', { from: 'a', to: 'b' })
    expect(handler).not.toHaveBeenCalled()
  })

  test('multiple subscribers on same path+event all receive', () => {
    const bus = new EventBus()
    const h1 = mock(() => {})
    const h2 = mock(() => {})
    bus.on('/repo/main', 'git:branch-changed', h1)
    bus.on('/repo/main', 'git:branch-changed', h2)
    bus.emit('/repo/main', 'git:branch-changed', { from: 'a', to: 'b' })
    expect(h1).toHaveBeenCalledTimes(1)
    expect(h2).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/infra/event-bus.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement EventBus**

```typescript
// packages/backend/src/infra/event-bus.ts

type Handler = (data: unknown) => void

interface Subscription {
  path: string
  event: string
  handler: Handler
}

export class EventBus {
  private subscriptions: Subscription[] = []

  on(path: string, event: string, handler: Handler): () => void {
    const sub: Subscription = { path, event, handler }
    this.subscriptions.push(sub)
    return () => {
      const idx = this.subscriptions.indexOf(sub)
      if (idx !== -1) this.subscriptions.splice(idx, 1)
    }
  }

  emit(path: string, event: string, data: unknown): void {
    for (const sub of this.subscriptions) {
      if (sub.event !== event) continue
      if (sub.path !== '*' && sub.path !== path) continue
      sub.handler(data)
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/infra/event-bus.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/infra/event-bus.ts packages/backend/tests/infra/event-bus.test.ts
git commit -m "feat(backend): add path-based EventBus pub/sub"
```

### Task 1.2: Store (SQLite)

SQLite persistence for workspaces and sessions using `bun:sqlite`.

**Files:**
- Create: `packages/backend/src/infra/store.ts`
- Create: `packages/backend/tests/infra/store.test.ts`
- Create: `packages/backend/tests/helpers/fixtures.ts`

- [ ] **Step 1: Create test fixtures**

```typescript
// packages/backend/tests/helpers/fixtures.ts
import type { Workspace, Session } from '../../src/types'

export function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: crypto.randomUUID(),
    path: '/tmp/test-repo',
    name: 'test-repo',
    createdAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString(),
    ...overrides,
  }
}

export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: crypto.randomUUID(),
    workspaceId: 'ws-1',
    claudeSessionId: null,
    name: 'test-session',
    sourceBranch: 'feat/test',
    targetBranch: 'dev',
    worktreePath: null,
    state: 'idle',
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    ...overrides,
  }
}
```

- [ ] **Step 2: Write store tests**

```typescript
// packages/backend/tests/infra/store.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Store } from '../../src/infra/store'
import { makeWorkspace, makeSession } from '../helpers/fixtures'
import { unlinkSync } from 'fs'

let store: Store
const DB_PATH = '/tmp/oncraft-test.db'

beforeEach(() => {
  store = new Store(DB_PATH)
})

afterEach(() => {
  store.close()
  try { unlinkSync(DB_PATH) } catch {}
})

describe('Store - Workspaces', () => {
  test('creates and retrieves a workspace', () => {
    const ws = makeWorkspace()
    store.createWorkspace(ws)
    const result = store.getWorkspace(ws.id)
    expect(result).toEqual(ws)
  })

  test('lists all workspaces', () => {
    const ws1 = makeWorkspace({ name: 'repo-a' })
    const ws2 = makeWorkspace({ name: 'repo-b' })
    store.createWorkspace(ws1)
    store.createWorkspace(ws2)
    const list = store.listWorkspaces()
    expect(list).toHaveLength(2)
  })

  test('deletes a workspace', () => {
    const ws = makeWorkspace()
    store.createWorkspace(ws)
    store.deleteWorkspace(ws.id)
    expect(store.getWorkspace(ws.id)).toBeNull()
  })

  test('updates lastOpenedAt', () => {
    const ws = makeWorkspace()
    store.createWorkspace(ws)
    const newTime = new Date().toISOString()
    store.updateWorkspaceLastOpened(ws.id, newTime)
    expect(store.getWorkspace(ws.id)!.lastOpenedAt).toBe(newTime)
  })
})

describe('Store - Sessions', () => {
  test('creates and retrieves a session', () => {
    const session = makeSession()
    store.createSession(session)
    const result = store.getSession(session.id)
    expect(result).toEqual(session)
  })

  test('lists sessions for a workspace', () => {
    const s1 = makeSession({ workspaceId: 'ws-1' })
    const s2 = makeSession({ workspaceId: 'ws-1' })
    const s3 = makeSession({ workspaceId: 'ws-2' })
    store.createSession(s1)
    store.createSession(s2)
    store.createSession(s3)
    expect(store.listSessions('ws-1')).toHaveLength(2)
    expect(store.listSessions('ws-2')).toHaveLength(1)
  })

  test('updates session state', () => {
    const session = makeSession({ state: 'idle' })
    store.createSession(session)
    store.updateSessionState(session.id, 'active')
    expect(store.getSession(session.id)!.state).toBe('active')
  })

  test('updates session metrics', () => {
    const session = makeSession()
    store.createSession(session)
    store.updateSessionMetrics(session.id, { costUsd: 0.05, inputTokens: 1000, outputTokens: 500 })
    const updated = store.getSession(session.id)!
    expect(updated.costUsd).toBe(0.05)
    expect(updated.inputTokens).toBe(1000)
  })

  test('updates claudeSessionId', () => {
    const session = makeSession()
    store.createSession(session)
    store.updateClaudeSessionId(session.id, 'claude-abc-123')
    expect(store.getSession(session.id)!.claudeSessionId).toBe('claude-abc-123')
  })

  test('deletes a session', () => {
    const session = makeSession()
    store.createSession(session)
    store.deleteSession(session.id)
    expect(store.getSession(session.id)).toBeNull()
  })

  test('deletes all sessions for a workspace', () => {
    const s1 = makeSession({ workspaceId: 'ws-1' })
    const s2 = makeSession({ workspaceId: 'ws-1' })
    store.createSession(s1)
    store.createSession(s2)
    store.deleteSessionsForWorkspace('ws-1')
    expect(store.listSessions('ws-1')).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/infra/store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement Store**

```typescript
// packages/backend/src/infra/store.ts
import { Database } from 'bun:sqlite'
import type { Workspace, Session, SessionState } from '../types'

export class Store {
  private db: Database

  constructor(dbPath: string = 'oncraft.db') {
    this.db = new Database(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastOpenedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        claudeSessionId TEXT,
        name TEXT NOT NULL,
        sourceBranch TEXT NOT NULL,
        targetBranch TEXT NOT NULL,
        worktreePath TEXT,
        state TEXT NOT NULL DEFAULT 'idle',
        createdAt TEXT NOT NULL,
        lastActivityAt TEXT NOT NULL,
        costUsd REAL NOT NULL DEFAULT 0,
        inputTokens INTEGER NOT NULL DEFAULT 0,
        outputTokens INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (workspaceId) REFERENCES workspaces(id)
      );
    `)
  }

  // --- Workspaces ---

  createWorkspace(ws: Workspace): void {
    this.db.prepare(
      'INSERT INTO workspaces (id, path, name, createdAt, lastOpenedAt) VALUES (?, ?, ?, ?, ?)'
    ).run(ws.id, ws.path, ws.name, ws.createdAt, ws.lastOpenedAt)
  }

  getWorkspace(id: string): Workspace | null {
    return this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Workspace | null
  }

  listWorkspaces(): Workspace[] {
    return this.db.prepare('SELECT * FROM workspaces ORDER BY lastOpenedAt DESC').all() as Workspace[]
  }

  updateWorkspaceLastOpened(id: string, lastOpenedAt: string): void {
    this.db.prepare('UPDATE workspaces SET lastOpenedAt = ? WHERE id = ?').run(lastOpenedAt, id)
  }

  deleteWorkspace(id: string): void {
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
  }

  // --- Sessions ---

  createSession(s: Session): void {
    this.db.prepare(
      `INSERT INTO sessions (id, workspaceId, claudeSessionId, name, sourceBranch, targetBranch,
       worktreePath, state, createdAt, lastActivityAt, costUsd, inputTokens, outputTokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(s.id, s.workspaceId, s.claudeSessionId, s.name, s.sourceBranch, s.targetBranch,
          s.worktreePath, s.state, s.createdAt, s.lastActivityAt, s.costUsd, s.inputTokens, s.outputTokens)
  }

  getSession(id: string): Session | null {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | null
  }

  listSessions(workspaceId: string): Session[] {
    return this.db.prepare('SELECT * FROM sessions WHERE workspaceId = ? ORDER BY createdAt DESC')
      .all(workspaceId) as Session[]
  }

  updateSessionState(id: string, state: SessionState): void {
    this.db.prepare('UPDATE sessions SET state = ?, lastActivityAt = ? WHERE id = ?')
      .run(state, new Date().toISOString(), id)
  }

  updateSessionMetrics(id: string, metrics: { costUsd: number; inputTokens: number; outputTokens: number }): void {
    this.db.prepare('UPDATE sessions SET costUsd = ?, inputTokens = ?, outputTokens = ? WHERE id = ?')
      .run(metrics.costUsd, metrics.inputTokens, metrics.outputTokens, id)
  }

  updateClaudeSessionId(id: string, claudeSessionId: string): void {
    this.db.prepare('UPDATE sessions SET claudeSessionId = ? WHERE id = ?').run(claudeSessionId, id)
  }

  updateSessionFields(id: string, fields: { name?: string; targetBranch?: string }): void {
    const sets: string[] = []
    const values: unknown[] = []
    if (fields.name !== undefined) { sets.push('name = ?'); values.push(fields.name) }
    if (fields.targetBranch !== undefined) { sets.push('targetBranch = ?'); values.push(fields.targetBranch) }
    if (sets.length === 0) return
    values.push(id)
    this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  }

  deleteSessionsForWorkspace(workspaceId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE workspaceId = ?').run(workspaceId)
  }

  close(): void {
    this.db.close()
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/infra/store.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/infra/store.ts packages/backend/tests/infra/store.test.ts packages/backend/tests/helpers/fixtures.ts
git commit -m "feat(backend): add SQLite store for workspaces and sessions"
```

---

## Phase 2: GitService

### Task 2.1: GitService Core

Wraps `simple-git` for branch, status, and worktree operations. Tests use real temporary git repos.

**Files:**
- Create: `packages/backend/src/services/git.service.ts`
- Create: `packages/backend/tests/services/git.service.test.ts`
- Create: `packages/backend/tests/helpers/test-repo.ts`

- [ ] **Step 1: Create test repo helper**

```typescript
// packages/backend/tests/helpers/test-repo.ts
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import simpleGit from 'simple-git'

export async function createTestRepo(): Promise<{ path: string; cleanup: () => void }> {
  const path = mkdtempSync(join(tmpdir(), 'oncraft-test-'))
  const git = simpleGit(path)
  await git.init()
  await git.addConfig('user.email', 'test@test.com')
  await git.addConfig('user.name', 'Test')
  writeFileSync(join(path, 'README.md'), '# Test')
  await git.add('.')
  await git.commit('initial commit')
  return {
    path,
    cleanup: () => rmSync(path, { recursive: true, force: true }),
  }
}
```

- [ ] **Step 2: Write GitService tests**

```typescript
// packages/backend/tests/services/git.service.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { GitService } from '../../src/services/git.service'
import { createTestRepo } from '../helpers/test-repo'

let gitService: GitService
let repoPath: string
let cleanup: () => void

beforeEach(async () => {
  const repo = await createTestRepo()
  repoPath = repo.path
  cleanup = repo.cleanup
  gitService = new GitService()
})

afterEach(() => cleanup())

describe('GitService - branches', () => {
  test('getBranch returns current branch', async () => {
    const branch = await gitService.getBranch(repoPath)
    expect(['main', 'master']).toContain(branch)
  })

  test('createBranch creates a new branch', async () => {
    await gitService.createBranch(repoPath, 'feat/test')
    const branches = await gitService.listBranches(repoPath)
    expect(branches.all).toContain('feat/test')
  })

  test('checkout switches branch', async () => {
    await gitService.createBranch(repoPath, 'feat/test')
    await gitService.checkout(repoPath, 'feat/test')
    const branch = await gitService.getBranch(repoPath)
    expect(branch).toBe('feat/test')
  })
})

describe('GitService - status', () => {
  test('getStatus returns clean status for fresh repo', async () => {
    const status = await gitService.getStatus(repoPath)
    expect(status.isClean()).toBe(true)
  })
})

describe('GitService - worktrees', () => {
  test('creates and lists worktrees', async () => {
    await gitService.createBranch(repoPath, 'feat/wt-test')
    const wtPath = `${repoPath}-wt`
    await gitService.createWorktree(repoPath, 'feat/wt-test', wtPath)
    const worktrees = await gitService.listWorktrees(repoPath)
    expect(worktrees.length).toBeGreaterThanOrEqual(2) // main + new
    // Verify the new worktree is on the right branch
    const wtBranch = await gitService.getBranch(wtPath)
    expect(wtBranch).toBe('feat/wt-test')
    // Cleanup
    await gitService.removeWorktree(repoPath, wtPath)
  })
})

describe('GitService - validation', () => {
  test('isGitRepo returns true for git repos', async () => {
    expect(await gitService.isGitRepo(repoPath)).toBe(true)
  })

  test('isGitRepo returns false for non-repos', async () => {
    expect(await gitService.isGitRepo('/tmp')).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/git.service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement GitService**

```typescript
// packages/backend/src/services/git.service.ts
import simpleGit, { type SimpleGit, type StatusResult, type BranchSummary } from 'simple-git'

export class GitService {
  private gitFor(path: string): SimpleGit {
    return simpleGit(path)
  }

  async isGitRepo(path: string): Promise<boolean> {
    try {
      return await this.gitFor(path).checkIsRepo()
    } catch {
      return false
    }
  }

  async getBranch(path: string): Promise<string> {
    const result = await this.gitFor(path).revparse(['--abbrev-ref', 'HEAD'])
    return result.trim()
  }

  async getStatus(path: string): Promise<StatusResult> {
    return this.gitFor(path).status()
  }

  async listBranches(path: string): Promise<BranchSummary> {
    return this.gitFor(path).branch()
  }

  async createBranch(path: string, name: string, from?: string): Promise<void> {
    const args = from ? [name, from] : [name]
    await this.gitFor(path).branch(args)
  }

  async checkout(path: string, branch: string): Promise<void> {
    await this.gitFor(path).checkout(branch)
  }

  async createWorktree(repoPath: string, branch: string, worktreePath: string): Promise<void> {
    await this.gitFor(repoPath).raw(['worktree', 'add', worktreePath, branch])
  }

  async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    await this.gitFor(repoPath).raw(['worktree', 'remove', worktreePath, '--force'])
  }

  async listWorktrees(repoPath: string): Promise<Array<{ path: string; branch: string; head: string }>> {
    const output = await this.gitFor(repoPath).raw(['worktree', 'list', '--porcelain'])
    const worktrees: Array<{ path: string; branch: string; head: string }> = []
    let current: Record<string, string> = {}
    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        current.path = line.slice('worktree '.length)
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice('HEAD '.length)
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice('branch refs/heads/'.length)
      } else if (line === '') {
        if (current.path) {
          worktrees.push({
            path: current.path,
            branch: current.branch || 'detached',
            head: current.head || '',
          })
        }
        current = {}
      }
    }
    return worktrees
  }

  async merge(path: string, source: string): Promise<void> {
    await this.gitFor(path).merge([source])
  }

  async rebase(path: string, branch: string, onto: string): Promise<void> {
    await this.gitFor(path).rebase([branch, '--onto', onto])
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/git.service.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/git.service.ts packages/backend/tests/services/git.service.test.ts packages/backend/tests/helpers/test-repo.ts
git commit -m "feat(backend): add GitService wrapping simple-git"
```

---

## Phase 3: GitWatcher

### Task 3.1: GitWatcher

Watches `.git/HEAD` files for branch changes. Emits events on the EventBus by path. Has zero domain knowledge — purely infrastructure.

**Files:**
- Create: `packages/backend/src/infra/git-watcher.ts`
- Create: `packages/backend/tests/infra/git-watcher.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// packages/backend/tests/infra/git-watcher.test.ts
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { GitWatcher } from '../../src/infra/git-watcher'
import { EventBus } from '../../src/infra/event-bus'
import { GitService } from '../../src/services/git.service'
import { createTestRepo } from '../helpers/test-repo'

let eventBus: EventBus
let gitService: GitService
let watcher: GitWatcher
let repoPath: string
let cleanupRepo: () => void

beforeEach(async () => {
  const repo = await createTestRepo()
  repoPath = repo.path
  cleanupRepo = repo.cleanup
  eventBus = new EventBus()
  gitService = new GitService()
  watcher = new GitWatcher(eventBus, gitService)
})

afterEach(async () => {
  await watcher.unwatchAll()
  cleanupRepo()
})

describe('GitWatcher', () => {
  test('emits git:branch-changed when branch switches', async () => {
    await gitService.createBranch(repoPath, 'feat/test')
    const received: unknown[] = []
    eventBus.on(repoPath, 'git:branch-changed', (data) => received.push(data))

    watcher.watch(repoPath)
    // Give watcher time to initialize
    await new Promise(r => setTimeout(r, 200))

    await gitService.checkout(repoPath, 'feat/test')
    // Wait for filesystem event + debounce
    await new Promise(r => setTimeout(r, 2000))

    expect(received.length).toBeGreaterThanOrEqual(1)
    const event = received[0] as { from: string; to: string }
    expect(event.to).toBe('feat/test')
  })

  test('unwatch stops emitting events', async () => {
    await gitService.createBranch(repoPath, 'feat/test')
    const received: unknown[] = []
    eventBus.on(repoPath, 'git:branch-changed', (data) => received.push(data))

    watcher.watch(repoPath)
    await new Promise(r => setTimeout(r, 200))
    watcher.unwatch(repoPath)

    await gitService.checkout(repoPath, 'feat/test')
    await new Promise(r => setTimeout(r, 1000))

    expect(received).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/infra/git-watcher.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement GitWatcher**

```typescript
// packages/backend/src/infra/git-watcher.ts
import { watch, type FSWatcher } from 'chokidar'
import { join } from 'path'
import type { EventBus } from './event-bus'
import type { GitService } from '../services/git.service'

export class GitWatcher {
  private watchers = new Map<string, FSWatcher>()
  private lastBranch = new Map<string, string>()

  constructor(
    private eventBus: EventBus,
    private gitService: GitService,
  ) {}

  watch(path: string): void {
    if (this.watchers.has(path)) return

    // Read initial branch
    this.gitService.getBranch(path).then(branch => {
      this.lastBranch.set(path, branch)
    })

    const gitDir = join(path, '.git')
    const watcher = watch([join(gitDir, 'HEAD'), join(gitDir, 'refs')], {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    })

    watcher.on('change', () => this.checkBranch(path))
    watcher.on('add', () => this.checkBranch(path))

    this.watchers.set(path, watcher)
  }

  unwatch(path: string): void {
    const watcher = this.watchers.get(path)
    if (watcher) {
      watcher.close()
      this.watchers.delete(path)
      this.lastBranch.delete(path)
    }
  }

  async unwatchAll(): Promise<void> {
    for (const [path] of this.watchers) {
      this.unwatch(path)
    }
  }

  private async checkBranch(path: string): Promise<void> {
    try {
      const currentBranch = await this.gitService.getBranch(path)
      const lastBranch = this.lastBranch.get(path)

      if (lastBranch && currentBranch !== lastBranch) {
        this.eventBus.emit(path, 'git:branch-changed', {
          path,
          from: lastBranch,
          to: currentBranch,
        })
      }
      this.lastBranch.set(path, currentBranch)
    } catch {
      // Path may be in the middle of a git operation — ignore transient errors
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/infra/git-watcher.test.ts`
Expected: All tests PASS (may need timeout adjustment for fs events)

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/infra/git-watcher.ts packages/backend/tests/infra/git-watcher.test.ts
git commit -m "feat(backend): add GitWatcher with chokidar filesystem watching"
```

---

## Phase 4: Session Bridge

### Task 4.1: Session Bridge Script

The standalone Bun script that bridges stdin/stdout to the Claude Agent SDK. This is the core of the SDK integration.

**Files:**
- Create: `packages/backend/src/bridge/session-bridge.ts`
- Create: `packages/backend/tests/bridge/session-bridge.test.ts`

- [ ] **Step 1: Write bridge integration tests**

These tests spawn the bridge as a child process and communicate via stdin/stdout, exactly as the ProcessManager will.

```typescript
// packages/backend/tests/bridge/session-bridge.test.ts
import { describe, test, expect } from 'bun:test'
import { join } from 'path'

const BRIDGE_PATH = join(import.meta.dir, '../../src/bridge/session-bridge.ts')

function spawnBridge(env: Record<string, string> = {}) {
  const proc = Bun.spawn(['bun', BRIDGE_PATH], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
  })
  return proc
}

async function readLine(reader: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  const streamReader = reader.getReader()
  let buffer = ''
  while (true) {
    const { value, done } = await streamReader.read()
    if (done) break
    buffer += decoder.decode(value)
    const newlineIdx = buffer.indexOf('\n')
    if (newlineIdx !== -1) {
      streamReader.releaseLock()
      return buffer.slice(0, newlineIdx)
    }
  }
  return buffer
}

function sendCommand(proc: ReturnType<typeof spawnBridge>, cmd: Record<string, unknown>) {
  const writer = proc.stdin!
  writer.write(JSON.stringify(cmd) + '\n')
}

describe('Session Bridge', () => {
  test('emits bridge:ready on startup', async () => {
    const proc = spawnBridge()
    const line = await readLine(proc.stdout!)
    const event = JSON.parse(line)
    expect(event.type).toBe('bridge:ready')
    sendCommand(proc, { cmd: 'stop' })
    await proc.exited
  })

  test('responds to stop command by exiting', async () => {
    const proc = spawnBridge()
    await readLine(proc.stdout!) // bridge:ready
    sendCommand(proc, { cmd: 'stop' })
    const exitCode = await proc.exited
    expect(exitCode).toBe(0)
  })
})
```

Note: Full SDK integration tests (sending messages, tool approval) require a valid API key and are tested as integration tests, not unit tests. The unit tests verify the bridge protocol (startup, shutdown, command parsing).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/bridge/session-bridge.test.ts`
Expected: FAIL — bridge script doesn't exist

- [ ] **Step 3: Implement session bridge**

```typescript
// packages/backend/src/bridge/session-bridge.ts
import { createInterface } from 'readline'

// --- Types ---

interface StartCommand {
  cmd: 'start'
  projectPath: string
  prompt: string
  sessionId?: string
  model?: string
  effort?: string
  permissionMode?: string
}

interface ReplyCommand {
  cmd: 'reply'
  toolUseID: string
  decision: 'allow' | 'deny'
}

interface InterruptCommand {
  cmd: 'interrupt'
}

interface StopCommand {
  cmd: 'stop'
}

interface LoadHistoryCommand {
  cmd: 'loadHistory'
  sessionId: string
}

type BridgeCommand = StartCommand | ReplyCommand | InterruptCommand | StopCommand | LoadHistoryCommand

// --- State ---

let activeAbort: AbortController | null = null
const pendingApprovals = new Map<string, (result: { behavior: 'allow' | 'deny' }) => void>()

// --- Helpers ---

function emit(event: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(event) + '\n')
}

// --- Message Stream ---
// AsyncIterable<SDKUserMessage> that we feed into query().
// New user messages are enqueued here; the SDK's query loop consumes them.

class MessageStream implements AsyncIterable<{ type: 'user'; content: string }> {
  private queue: Array<{ type: 'user'; content: string }> = []
  private resolve: (() => void) | null = null
  private done = false

  enqueue(message: string): void {
    this.queue.push({ type: 'user', content: message })
    this.resolve?.()
    this.resolve = null
  }

  end(): void {
    this.done = true
    this.resolve?.()
    this.resolve = null
  }

  [Symbol.asyncIterator](): AsyncIterator<{ type: 'user'; content: string }> {
    return {
      next: async () => {
        while (this.queue.length === 0 && !this.done) {
          await new Promise<void>(r => { this.resolve = r })
        }
        if (this.queue.length > 0) {
          return { value: this.queue.shift()!, done: false }
        }
        return { value: undefined as never, done: true }
      },
    }
  }
}

let activeStream: MessageStream | null = null

// --- Command Handlers ---

async function handleStart(cmd: StartCommand): Promise<void> {
  // If there's already an active stream, enqueue the message
  if (activeStream) {
    activeStream.enqueue(cmd.prompt)
    return
  }

  // Dynamic import to avoid loading SDK at module level
  const sdk = await import('@anthropic-ai/claude-agent-sdk')

  activeStream = new MessageStream()
  activeStream.enqueue(cmd.prompt)
  activeAbort = new AbortController()

  const options: Record<string, unknown> = {
    cwd: cmd.projectPath,
    abortController: activeAbort,
    settingSources: ['user', 'project', 'local'],
    model: cmd.model,
    permissionMode: cmd.permissionMode,
  }

  if (cmd.sessionId) {
    options.resume = cmd.sessionId
  }

  try {
    const result = sdk.query({
      prompt: activeStream,
      options,
      canUseTool: async (toolName, toolInput, toolOptions) => {
        const toolUseID = toolOptions.toolUseID
        emit({
          type: 'tool_confirmation',
          toolUseID,
          toolName,
          toolInput,
          agentID: toolOptions.agentID,
          decisionReason: toolOptions.decisionReason,
        })
        return new Promise<{ behavior: 'allow' | 'deny' }>((resolve) => {
          pendingApprovals.set(toolUseID, resolve)
        })
      },
    })

    for await (const message of result) {
      emit(message as Record<string, unknown>)
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      emit({ type: 'bridge:error', message: String(err) })
    }
  } finally {
    activeStream = null
    activeAbort = null
  }
}

function handleReply(cmd: ReplyCommand): void {
  const resolve = pendingApprovals.get(cmd.toolUseID)
  if (resolve) {
    resolve({ behavior: cmd.decision })
    pendingApprovals.delete(cmd.toolUseID)
  }
}

function handleInterrupt(): void {
  if (activeAbort) {
    activeAbort.abort()
  }
  if (activeStream) {
    activeStream.end()
  }
}

async function handleLoadHistory(cmd: LoadHistoryCommand): Promise<void> {
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    const messages = await sdk.getSessionMessages(cmd.sessionId)
    emit({ type: 'bridge:history', messages })
  } catch (err) {
    emit({ type: 'bridge:error', message: `Failed to load history: ${err}` })
  }
}

// --- Main Loop ---

emit({ type: 'bridge:ready' })

const rl = createInterface({ input: process.stdin })

rl.on('line', async (line) => {
  try {
    const cmd = JSON.parse(line) as BridgeCommand

    switch (cmd.cmd) {
      case 'start':
        handleStart(cmd)
        break
      case 'reply':
        handleReply(cmd)
        break
      case 'interrupt':
        handleInterrupt()
        break
      case 'loadHistory':
        await handleLoadHistory(cmd)
        break
      case 'stop':
        rl.close()
        process.exit(0)
        break
    }
  } catch (err) {
    emit({ type: 'bridge:error', message: `Invalid command: ${err}` })
  }
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/bridge/session-bridge.test.ts`
Expected: bridge:ready and stop tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/bridge/session-bridge.ts packages/backend/tests/bridge/session-bridge.test.ts
git commit -m "feat(backend): add session bridge (SDK <-> stdin/stdout)"
```

---

## Phase 5: ProcessManager

### Task 5.1: ProcessManager

Manages child process lifecycle for session bridges — spawning, communicating, and killing processes.

**Files:**
- Create: `packages/backend/src/services/process-manager.ts`
- Create: `packages/backend/tests/services/process-manager.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// packages/backend/tests/services/process-manager.test.ts
import { describe, test, expect, afterEach } from 'bun:test'
import { ProcessManager } from '../../src/services/process-manager'
import { EventBus } from '../../src/infra/event-bus'

let pm: ProcessManager
let eventBus: EventBus

afterEach(async () => {
  if (pm) await pm.stopAll()
})

describe('ProcessManager', () => {
  test('spawns a bridge process and receives bridge:ready', async () => {
    eventBus = new EventBus()
    pm = new ProcessManager(eventBus)

    const events: unknown[] = []
    eventBus.on('*', 'session:message', (data) => events.push(data))

    await pm.spawn('session-1', '/tmp')
    // Wait for bridge:ready
    await new Promise(r => setTimeout(r, 500))

    expect(pm.isAlive('session-1')).toBe(true)
  })

  test('sends command and receives events', async () => {
    eventBus = new EventBus()
    pm = new ProcessManager(eventBus)

    await pm.spawn('session-1', '/tmp')
    await new Promise(r => setTimeout(r, 300))

    // Stop should work cleanly
    await pm.stop('session-1')
    expect(pm.isAlive('session-1')).toBe(false)
  })

  test('kill cleans up process', async () => {
    eventBus = new EventBus()
    pm = new ProcessManager(eventBus)

    await pm.spawn('session-1', '/tmp')
    await new Promise(r => setTimeout(r, 300))

    pm.kill('session-1')
    await new Promise(r => setTimeout(r, 200))
    expect(pm.isAlive('session-1')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/process-manager.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ProcessManager**

```typescript
// packages/backend/src/services/process-manager.ts
import { join } from 'path'
import type { EventBus } from '../infra/event-bus'

const BRIDGE_PATH = join(import.meta.dir, '../bridge/session-bridge.ts')

interface ManagedProcess {
  proc: ReturnType<typeof Bun.spawn>
  sessionId: string
  cwd: string
}

export class ProcessManager {
  private processes = new Map<string, ManagedProcess>()

  constructor(private eventBus: EventBus) {}

  async spawn(sessionId: string, cwd: string, env: Record<string, string> = {}): Promise<void> {
    if (this.processes.has(sessionId)) {
      throw new Error(`Process already exists for session ${sessionId}`)
    }

    const proc = Bun.spawn(['bun', BRIDGE_PATH], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      cwd,
      env: { ...process.env, ...env },
    })

    const managed: ManagedProcess = { proc, sessionId, cwd }
    this.processes.set(sessionId, managed)

    // Read stdout line by line and emit events
    this.readLines(sessionId, proc.stdout!)

    // Handle process exit
    proc.exited.then((code) => {
      this.processes.delete(sessionId)
      this.eventBus.emit(cwd, 'session:process-exit', { sessionId, code })
    })
  }

  send(sessionId: string, command: Record<string, unknown>): void {
    const managed = this.processes.get(sessionId)
    if (!managed) throw new Error(`No process for session ${sessionId}`)
    managed.proc.stdin!.write(JSON.stringify(command) + '\n')
  }

  async stop(sessionId: string): Promise<void> {
    const managed = this.processes.get(sessionId)
    if (!managed) return
    this.send(sessionId, { cmd: 'stop' })
    await managed.proc.exited
  }

  kill(sessionId: string): void {
    const managed = this.processes.get(sessionId)
    if (!managed) return
    managed.proc.kill()
    this.processes.delete(sessionId)
  }

  isAlive(sessionId: string): boolean {
    return this.processes.has(sessionId)
  }

  async waitForReady(sessionId: string, timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Bridge ready timeout')), timeoutMs)
      const unsub = this.eventBus.on('*', 'session:message', (data) => {
        const msg = data as { sessionId: string; type: string }
        if (msg.sessionId === sessionId && msg.type === 'bridge:ready') {
          clearTimeout(timer)
          unsub()
          resolve()
        }
      })
    })
  }

  async stopAll(): Promise<void> {
    const promises = Array.from(this.processes.keys()).map(id => this.stop(id))
    await Promise.allSettled(promises)
  }

  private async readLines(sessionId: string, stdout: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder()
    const reader = stdout.getReader()
    let buffer = ''

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value)

        let newlineIdx: number
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIdx)
          buffer = buffer.slice(newlineIdx + 1)
          if (line.trim()) {
            try {
              const event = JSON.parse(line)
              const managed = this.processes.get(sessionId)
              const path = managed?.cwd ?? '*'
              this.eventBus.emit(path, 'session:message', { sessionId, ...event })
            } catch {
              // Non-JSON output, ignore
            }
          }
        }
      }
    } catch {
      // Stream closed
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/process-manager.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/process-manager.ts packages/backend/tests/services/process-manager.test.ts
git commit -m "feat(backend): add ProcessManager for bridge child process lifecycle"
```

---

## Phase 6: WorkspaceService & SessionService

### Task 6.1: WorkspaceService

Orchestrates workspace CRUD, GitWatcher lifecycle, and git validation.

**Files:**
- Create: `packages/backend/src/services/workspace.service.ts`
- Create: `packages/backend/tests/services/workspace.service.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// packages/backend/tests/services/workspace.service.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { WorkspaceService } from '../../src/services/workspace.service'
import { Store } from '../../src/infra/store'
import { EventBus } from '../../src/infra/event-bus'
import { GitService } from '../../src/services/git.service'
import { GitWatcher } from '../../src/infra/git-watcher'
import { createTestRepo } from '../helpers/test-repo'
import { unlinkSync } from 'fs'

const DB_PATH = '/tmp/oncraft-ws-test.db'
let service: WorkspaceService
let store: Store
let repoPath: string
let cleanupRepo: () => void

beforeEach(async () => {
  const repo = await createTestRepo()
  repoPath = repo.path
  cleanupRepo = repo.cleanup
  store = new Store(DB_PATH)
  const eventBus = new EventBus()
  const gitService = new GitService()
  const gitWatcher = new GitWatcher(eventBus, gitService)
  service = new WorkspaceService(store, gitService, gitWatcher)
})

afterEach(async () => {
  await service.closeAll()
  store.close()
  cleanupRepo()
  try { unlinkSync(DB_PATH) } catch {}
})

describe('WorkspaceService', () => {
  test('opens a git repo as workspace', async () => {
    const ws = await service.open(repoPath)
    expect(ws.path).toBe(repoPath)
    expect(ws.name).toBeTruthy()
  })

  test('rejects non-git directories', async () => {
    await expect(service.open('/tmp')).rejects.toThrow()
  })

  test('returns existing workspace if path already open', async () => {
    const ws1 = await service.open(repoPath)
    const ws2 = await service.open(repoPath)
    expect(ws1.id).toBe(ws2.id)
  })

  test('lists open workspaces', async () => {
    await service.open(repoPath)
    const list = await service.list()
    expect(list).toHaveLength(1)
  })

  test('get includes live branch', async () => {
    const ws = await service.open(repoPath)
    const full = await service.get(ws.id)
    expect(full).toBeTruthy()
    expect(full!.branch).toBeTruthy()
  })

  test('close removes workspace', async () => {
    const ws = await service.open(repoPath)
    await service.close(ws.id)
    expect(await service.get(ws.id)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/workspace.service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement WorkspaceService**

```typescript
// packages/backend/src/services/workspace.service.ts
import { basename } from 'path'
import type { Workspace } from '../types'
import type { Store } from '../infra/store'
import type { GitService } from './git.service'
import type { GitWatcher } from '../infra/git-watcher'

export interface WorkspaceWithBranch extends Workspace {
  branch: string
}

export class WorkspaceService {
  constructor(
    private store: Store,
    private gitService: GitService,
    private gitWatcher: GitWatcher,
  ) {}

  async open(path: string, name?: string): Promise<Workspace> {
    const isRepo = await this.gitService.isGitRepo(path)
    if (!isRepo) throw new Error(`Not a git repository: ${path}`)

    // Check if already open
    const existing = this.store.listWorkspaces().find(ws => ws.path === path)
    if (existing) {
      this.store.updateWorkspaceLastOpened(existing.id, new Date().toISOString())
      return existing
    }

    const workspace: Workspace = {
      id: crypto.randomUUID(),
      path,
      name: name ?? basename(path),
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    }

    this.store.createWorkspace(workspace)
    this.gitWatcher.watch(path)
    return workspace
  }

  async get(id: string): Promise<WorkspaceWithBranch | null> {
    const ws = this.store.getWorkspace(id)
    if (!ws) return null
    const branch = await this.gitService.getBranch(ws.path)
    return { ...ws, branch }
  }

  async list(): Promise<Workspace[]> {
    return this.store.listWorkspaces()
  }

  async close(id: string): Promise<void> {
    const ws = this.store.getWorkspace(id)
    if (!ws) return
    this.gitWatcher.unwatch(ws.path)
    this.store.deleteSessionsForWorkspace(id)
    this.store.deleteWorkspace(id)
  }

  async closeAll(): Promise<void> {
    const workspaces = this.store.listWorkspaces()
    for (const ws of workspaces) {
      this.gitWatcher.unwatch(ws.path)
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/workspace.service.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/workspace.service.ts packages/backend/tests/services/workspace.service.test.ts
git commit -m "feat(backend): add WorkspaceService with git validation and watcher lifecycle"
```

### Task 6.2: SessionService

Orchestrates session CRUD, ProcessManager interaction, git context tracking, and worktree conflict warnings.

**Files:**
- Create: `packages/backend/src/services/session.service.ts`
- Create: `packages/backend/tests/services/session.service.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// packages/backend/tests/services/session.service.test.ts
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { SessionService } from '../../src/services/session.service'
import { Store } from '../../src/infra/store'
import { EventBus } from '../../src/infra/event-bus'
import { GitService } from '../../src/services/git.service'
import { ProcessManager } from '../../src/services/process-manager'
import { createTestRepo } from '../helpers/test-repo'
import { makeWorkspace } from '../helpers/fixtures'
import { unlinkSync } from 'fs'

const DB_PATH = '/tmp/oncraft-session-test.db'
let service: SessionService
let store: Store
let eventBus: EventBus
let processManager: ProcessManager
let repoPath: string
let cleanupRepo: () => void

beforeEach(async () => {
  const repo = await createTestRepo()
  repoPath = repo.path
  cleanupRepo = repo.cleanup
  store = new Store(DB_PATH)
  eventBus = new EventBus()
  const gitService = new GitService()
  processManager = new ProcessManager(eventBus)
  service = new SessionService(store, eventBus, gitService, processManager)

  // Create a workspace first
  const ws = makeWorkspace({ id: 'ws-1', path: repoPath })
  store.createWorkspace(ws)
})

afterEach(async () => {
  await processManager.stopAll()
  store.close()
  cleanupRepo()
  try { unlinkSync(DB_PATH) } catch {}
})

describe('SessionService', () => {
  test('creates a session with git context', async () => {
    const session = await service.create('ws-1', {
      name: 'Auth feature',
      sourceBranch: 'feat/auth',
      targetBranch: 'dev',
      useWorktree: false,
    })
    expect(session.workspaceId).toBe('ws-1')
    expect(session.sourceBranch).toBe('feat/auth')
    expect(session.targetBranch).toBe('dev')
    expect(session.state).toBe('idle')
  })

  test('creates a session with worktree', async () => {
    const gitService = new GitService()
    await gitService.createBranch(repoPath, 'feat/wt-test')

    const session = await service.create('ws-1', {
      name: 'WT session',
      sourceBranch: 'feat/wt-test',
      targetBranch: 'main',
      useWorktree: true,
    })
    expect(session.worktreePath).toBeTruthy()
    expect(session.state).toBe('idle')

    // Cleanup
    await service.destroy(session.id)
  })

  test('lists sessions for workspace', async () => {
    await service.create('ws-1', { name: 's1', sourceBranch: 'a', targetBranch: 'b', useWorktree: false })
    await service.create('ws-1', { name: 's2', sourceBranch: 'c', targetBranch: 'd', useWorktree: false })
    const sessions = service.list('ws-1')
    expect(sessions).toHaveLength(2)
  })

  test('emits worktree conflict warning when two sessions on same worktree become active', async () => {
    const s1 = await service.create('ws-1', { name: 's1', sourceBranch: 'a', targetBranch: 'b', useWorktree: false })
    const s2 = await service.create('ws-1', { name: 's2', sourceBranch: 'c', targetBranch: 'd', useWorktree: false })

    const warnings: unknown[] = []
    eventBus.on('*', 'session:worktree-conflict', (data) => warnings.push(data))

    // Simulate both becoming active — service.setActive is called by send()
    store.updateSessionState(s1.id, 'active')
    service.checkWorktreeConflict(s2.id, 'active')

    expect(warnings).toHaveLength(1)
  })

  test('destroy cleans up session', async () => {
    const session = await service.create('ws-1', { name: 's1', sourceBranch: 'a', targetBranch: 'b', useWorktree: false })
    await service.destroy(session.id)
    expect(service.get(session.id)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/session.service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement SessionService**

```typescript
// packages/backend/src/services/session.service.ts
import { join } from 'path'
import type { Session, SessionState } from '../types'
import type { Store } from '../infra/store'
import type { EventBus } from '../infra/event-bus'
import type { GitService } from './git.service'
import type { ProcessManager } from './process-manager'

interface CreateSessionOptions {
  name: string
  sourceBranch: string
  targetBranch: string
  useWorktree: boolean
}

interface SendOptions {
  model?: string
  effort?: string
  permissionMode?: string
}

export class SessionService {
  constructor(
    private store: Store,
    private eventBus: EventBus,
    private gitService: GitService,
    private processManager: ProcessManager,
  ) {
    // Subscribe to git branch changes and match to sessions
    this.eventBus.on('*', 'git:branch-changed', (data) => {
      const { path, from, to } = data as { path: string; from: string; to: string }
      this.handleBranchChange(path, from, to)
    })

    // Subscribe to process exit events
    this.eventBus.on('*', 'session:process-exit', (data) => {
      const { sessionId, code } = data as { sessionId: string; code: number }
      const session = this.store.getSession(sessionId)
      if (session && session.state === 'active') {
        this.setState(sessionId, code === 0 ? 'idle' : 'error')
      }
    })

    // Subscribe to session messages to extract metrics from result events
    this.eventBus.on('*', 'session:message', (data) => {
      const msg = data as { sessionId: string; type: string; [key: string]: unknown }
      if (msg.type === 'result') {
        const { sessionId, costUsd, usage } = msg as {
          sessionId: string; costUsd?: number; usage?: { inputTokens?: number; outputTokens?: number }
        }
        if (costUsd !== undefined || usage) {
          this.store.updateSessionMetrics(sessionId, {
            costUsd: costUsd ?? 0,
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
          })
          this.eventBus.emit('*', 'session:result', { sessionId, costUsd, ...usage })
        }
        // Result means query finished — transition to idle
        this.setState(sessionId, 'idle')
      }
      // Capture claudeSessionId from init messages
      if (msg.type === 'system' && (msg as Record<string, unknown>).subtype === 'init') {
        const initSessionId = (msg as Record<string, unknown>).sessionId as string | undefined
        if (initSessionId && msg.sessionId) {
          this.store.updateClaudeSessionId(msg.sessionId, initSessionId)
        }
      }
    })
  }

  async create(workspaceId: string, opts: CreateSessionOptions): Promise<Session> {
    const workspace = this.store.getWorkspace(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    let worktreePath: string | null = null

    if (opts.useWorktree) {
      const worktreeDir = join(workspace.path, '..', `.oncraft-worktrees`, opts.sourceBranch.replace(/\//g, '-'))
      await this.gitService.createWorktree(workspace.path, opts.sourceBranch, worktreeDir)
      worktreePath = worktreeDir
    }

    const session: Session = {
      id: crypto.randomUUID(),
      workspaceId,
      claudeSessionId: null,
      name: opts.name,
      sourceBranch: opts.sourceBranch,
      targetBranch: opts.targetBranch,
      worktreePath,
      state: 'idle',
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    }

    this.store.createSession(session)
    return session
  }

  get(id: string): Session | null {
    return this.store.getSession(id)
  }

  list(workspaceId: string): Session[] {
    return this.store.listSessions(workspaceId)
  }

  update(id: string, fields: { name?: string; targetBranch?: string }): void {
    this.store.updateSessionFields(id, fields)
  }

  async send(sessionId: string, message: string, opts: SendOptions = {}): Promise<void> {
    const session = this.store.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    if (session.state === 'completed' || session.state === 'error') {
      throw new Error(`Cannot send to session in ${session.state} state`)
    }

    const workspace = this.store.getWorkspace(session.workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${session.workspaceId}`)

    const cwd = session.worktreePath ?? workspace.path

    // Check worktree conflict before activating
    this.checkWorktreeConflict(sessionId, 'active')

    if (!this.processManager.isAlive(sessionId)) {
      this.setState(sessionId, 'starting')
      await this.processManager.spawn(sessionId, cwd)
      // Wait for bridge:ready event from ProcessManager
      await this.processManager.waitForReady(sessionId)
    }

    this.setState(sessionId, 'active')

    this.processManager.send(sessionId, {
      cmd: 'start',
      projectPath: cwd,
      prompt: message,
      sessionId: session.claudeSessionId ?? undefined,
      model: opts.model,
      effort: opts.effort,
      permissionMode: opts.permissionMode,
    })
  }

  reply(sessionId: string, toolUseID: string, decision: 'allow' | 'deny'): void {
    this.processManager.send(sessionId, { cmd: 'reply', toolUseID, decision })
  }

  interrupt(sessionId: string): void {
    this.processManager.send(sessionId, { cmd: 'interrupt' })
    this.setState(sessionId, 'idle')
  }

  async stop(sessionId: string): Promise<void> {
    await this.processManager.stop(sessionId)
    this.setState(sessionId, 'stopped')
  }

  async resume(sessionId: string): Promise<void> {
    const session = this.store.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    if (!session.claudeSessionId) throw new Error('No Claude session to resume')
    // Reset to idle — next send() will spawn a new process with resume: claudeSessionId
    this.setState(sessionId, 'idle')
  }

  async loadHistory(sessionId: string): Promise<void> {
    const session = this.store.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    if (!this.processManager.isAlive(sessionId)) {
      const workspace = this.store.getWorkspace(session.workspaceId)
      if (!workspace) throw new Error(`Workspace not found`)
      const cwd = session.worktreePath ?? workspace.path
      await this.processManager.spawn(sessionId, cwd)
      await this.processManager.waitForReady(sessionId)
    }
    this.processManager.send(sessionId, { cmd: 'loadHistory', sessionId: session.claudeSessionId })
  }

  // Centralized state transition — emits on EventBus so WebSocket handler picks it up
  private setState(sessionId: string, state: SessionState): void {
    const session = this.store.getSession(sessionId)
    const from = session?.state ?? 'idle'
    this.store.updateSessionState(sessionId, state)
    const workspace = session ? this.store.getWorkspace(session.workspaceId) : null
    const path = session?.worktreePath ?? workspace?.path ?? '*'
    this.eventBus.emit(path, 'session:state', { sessionId, from, to: state })
  }

  async destroy(sessionId: string): Promise<void> {
    const session = this.store.getSession(sessionId)
    if (!session) return

    if (this.processManager.isAlive(sessionId)) {
      await this.processManager.stop(sessionId)
    }

    if (session.worktreePath) {
      const workspace = this.store.getWorkspace(session.workspaceId)
      if (workspace) {
        try {
          await this.gitService.removeWorktree(workspace.path, session.worktreePath)
        } catch { /* worktree may already be gone */ }
      }
    }

    this.store.deleteSession(sessionId)
  }

  checkWorktreeConflict(sessionId: string, newState: SessionState): void {
    if (newState !== 'active') return

    const session = this.store.getSession(sessionId)
    if (!session) return

    const workspace = this.store.getWorkspace(session.workspaceId)
    if (!workspace) return

    const allSessions = this.store.listSessions(session.workspaceId)
    const worktreePath = session.worktreePath ?? workspace.path

    const conflicts = allSessions.filter(s =>
      s.id !== sessionId &&
      s.state === 'active' &&
      (s.worktreePath ?? workspace.path) === worktreePath
    )

    if (conflicts.length > 0) {
      this.eventBus.emit(worktreePath, 'session:worktree-conflict', {
        sessionId,
        conflictsWith: conflicts.map(s => s.id),
        worktreePath,
      })
    }
  }

  private handleBranchChange(path: string, from: string, to: string): void {
    // Find sessions working on this path
    const allWorkspaces = this.store.listWorkspaces()
    for (const ws of allWorkspaces) {
      const sessions = this.store.listSessions(ws.id)
      for (const session of sessions) {
        const sessionPath = session.worktreePath ?? ws.path
        if (sessionPath === path && session.sourceBranch !== to) {
          this.eventBus.emit(path, 'session:branch-mismatch', {
            sessionId: session.id,
            expected: session.sourceBranch,
            actual: to,
            from,
          })

          // If session is active, inject system message by interrupting and notifying
          if (session.state === 'active' && this.processManager.isAlive(session.id)) {
            this.processManager.send(session.id, { cmd: 'interrupt' })
            // The frontend will show the mismatch warning and let the user decide
          }
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/session.service.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/session.service.ts packages/backend/tests/services/session.service.test.ts
git commit -m "feat(backend): add SessionService with git context and worktree conflict detection"
```

---

## Phase 7: Backend Routes

### Task 7.1: Workspace Routes

**Files:**
- Create: `packages/backend/src/routes/workspace.routes.ts`
- Create: `packages/backend/tests/routes/workspace.routes.test.ts`

- [ ] **Step 1: Write route tests**

Tests use Fastify's `.inject()` for HTTP-level testing without starting a real server.

```typescript
// packages/backend/tests/routes/workspace.routes.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { buildApp } from '../helpers/build-app'
import { createTestRepo } from '../helpers/test-repo'

let app: Awaited<ReturnType<typeof buildApp>>
let repoPath: string
let cleanupRepo: () => void

beforeEach(async () => {
  const repo = await createTestRepo()
  repoPath = repo.path
  cleanupRepo = repo.cleanup
  app = await buildApp()
})

afterEach(async () => {
  await app.close()
  cleanupRepo()
})

describe('Workspace routes', () => {
  test('POST /workspaces opens a repo', async () => {
    const res = await app.inject({ method: 'POST', url: '/workspaces', payload: { path: repoPath } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.path).toBe(repoPath)
    expect(body.id).toBeTruthy()
  })

  test('POST /workspaces rejects non-git path', async () => {
    const res = await app.inject({ method: 'POST', url: '/workspaces', payload: { path: '/tmp' } })
    expect(res.statusCode).toBe(400)
  })

  test('GET /workspaces lists all', async () => {
    await app.inject({ method: 'POST', url: '/workspaces', payload: { path: repoPath } })
    const res = await app.inject({ method: 'GET', url: '/workspaces' })
    expect(res.json()).toHaveLength(1)
  })

  test('GET /workspaces/:id includes branch', async () => {
    const created = (await app.inject({ method: 'POST', url: '/workspaces', payload: { path: repoPath } })).json()
    const res = await app.inject({ method: 'GET', url: `/workspaces/${created.id}` })
    expect(res.json().branch).toBeTruthy()
  })

  test('DELETE /workspaces/:id removes workspace', async () => {
    const created = (await app.inject({ method: 'POST', url: '/workspaces', payload: { path: repoPath } })).json()
    const res = await app.inject({ method: 'DELETE', url: `/workspaces/${created.id}` })
    expect(res.statusCode).toBe(204)
  })
})
```

- [ ] **Step 2: Create build-app test helper**

```typescript
// packages/backend/tests/helpers/build-app.ts
import Fastify from 'fastify'
import { Store } from '../../src/infra/store'
import { EventBus } from '../../src/infra/event-bus'
import { GitService } from '../../src/services/git.service'
import { GitWatcher } from '../../src/infra/git-watcher'
import { ProcessManager } from '../../src/services/process-manager'
import { WorkspaceService } from '../../src/services/workspace.service'
import { SessionService } from '../../src/services/session.service'
import { registerWorkspaceRoutes } from '../../src/routes/workspace.routes'
import { registerSessionRoutes } from '../../src/routes/session.routes'
import { registerGitRoutes } from '../../src/routes/git.routes'

export async function buildApp() {
  const dbPath = `/tmp/oncraft-route-test-${Date.now()}.db`
  const store = new Store(dbPath)
  const eventBus = new EventBus()
  const gitService = new GitService()
  const gitWatcher = new GitWatcher(eventBus, gitService)
  const processManager = new ProcessManager(eventBus)
  const workspaceService = new WorkspaceService(store, gitService, gitWatcher)
  const sessionService = new SessionService(store, eventBus, gitService, processManager)

  const app = Fastify()
  registerWorkspaceRoutes(app, workspaceService)
  registerSessionRoutes(app, sessionService)
  registerGitRoutes(app, workspaceService, gitService)
  await app.ready()

  const originalClose = app.close.bind(app)
  app.close = async () => {
    await processManager.stopAll()
    await gitWatcher.unwatchAll()
    store.close()
    try { require('fs').unlinkSync(dbPath) } catch {}
    return originalClose()
  }

  return app
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/routes/workspace.routes.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 4: Implement workspace routes**

```typescript
// packages/backend/src/routes/workspace.routes.ts
import type { FastifyInstance } from 'fastify'
import type { WorkspaceService } from '../services/workspace.service'

export function registerWorkspaceRoutes(app: FastifyInstance, workspaceService: WorkspaceService): void {
  app.post('/workspaces', async (request, reply) => {
    const { path, name } = request.body as { path: string; name?: string }
    try {
      const workspace = await workspaceService.open(path, name)
      return workspace
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message, code: 'INVALID_PATH' })
    }
  })

  app.get('/workspaces', async () => {
    return workspaceService.list()
  })

  app.get('/workspaces/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const workspace = await workspaceService.get(id)
    if (!workspace) return reply.status(404).send({ error: 'Workspace not found', code: 'NOT_FOUND' })
    return workspace
  })

  app.delete('/workspaces/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    await workspaceService.close(id)
    return reply.status(204).send()
  })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/routes/workspace.routes.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/routes/workspace.routes.ts packages/backend/tests/routes/workspace.routes.test.ts packages/backend/tests/helpers/build-app.ts
git commit -m "feat(backend): add workspace REST routes"
```

### Task 7.2: Session Routes

**Files:**
- Create: `packages/backend/src/routes/session.routes.ts`
- Create: `packages/backend/tests/routes/session.routes.test.ts`

- [ ] **Step 1: Write session route tests**

```typescript
// packages/backend/tests/routes/session.routes.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { buildApp } from '../helpers/build-app'
import { createTestRepo } from '../helpers/test-repo'

let app: Awaited<ReturnType<typeof buildApp>>
let repoPath: string
let cleanupRepo: () => void
let workspaceId: string

beforeEach(async () => {
  const repo = await createTestRepo()
  repoPath = repo.path
  cleanupRepo = repo.cleanup
  app = await buildApp()

  // Create workspace
  const wsRes = await app.inject({ method: 'POST', url: '/workspaces', payload: { path: repoPath } })
  workspaceId = wsRes.json().id
})

afterEach(async () => {
  await app.close()
  cleanupRepo()
})

describe('Session routes', () => {
  test('POST creates a session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/sessions`,
      payload: { name: 'test', sourceBranch: 'feat/x', targetBranch: 'dev', useWorktree: false },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().sourceBranch).toBe('feat/x')
  })

  test('GET lists sessions for workspace', async () => {
    await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/sessions`,
      payload: { name: 's1', sourceBranch: 'a', targetBranch: 'b', useWorktree: false },
    })
    const res = await app.inject({ method: 'GET', url: `/workspaces/${workspaceId}/sessions` })
    expect(res.json()).toHaveLength(1)
  })

  test('GET /sessions/:id returns session', async () => {
    const created = (await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/sessions`,
      payload: { name: 's1', sourceBranch: 'a', targetBranch: 'b', useWorktree: false },
    })).json()
    const res = await app.inject({ method: 'GET', url: `/sessions/${created.id}` })
    expect(res.json().id).toBe(created.id)
  })

  test('DELETE /sessions/:id destroys session', async () => {
    const created = (await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/sessions`,
      payload: { name: 's1', sourceBranch: 'a', targetBranch: 'b', useWorktree: false },
    })).json()
    const res = await app.inject({ method: 'DELETE', url: `/sessions/${created.id}` })
    expect(res.statusCode).toBe(204)
  })

  test('PATCH /sessions/:id updates metadata', async () => {
    const created = (await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/sessions`,
      payload: { name: 's1', sourceBranch: 'a', targetBranch: 'b', useWorktree: false },
    })).json()
    const res = await app.inject({
      method: 'PATCH',
      url: `/sessions/${created.id}`,
      payload: { name: 'renamed' },
    })
    expect(res.json().name).toBe('renamed')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement session routes**

```typescript
// packages/backend/src/routes/session.routes.ts
import type { FastifyInstance } from 'fastify'
import type { SessionService } from '../services/session.service'

export function registerSessionRoutes(app: FastifyInstance, sessionService: SessionService): void {
  app.post('/workspaces/:workspaceId/sessions', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const { name, sourceBranch, targetBranch, useWorktree } = request.body as {
      name: string; sourceBranch: string; targetBranch: string; useWorktree: boolean
    }
    if (!sourceBranch || !targetBranch) {
      return reply.status(400).send({ error: 'sourceBranch and targetBranch are required', code: 'VALIDATION' })
    }
    try {
      return await sessionService.create(workspaceId, { name, sourceBranch, targetBranch, useWorktree })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message, code: 'CREATE_FAILED' })
    }
  })

  app.get('/workspaces/:workspaceId/sessions', async (request) => {
    const { workspaceId } = request.params as { workspaceId: string }
    return sessionService.list(workspaceId)
  })

  app.get('/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const session = sessionService.get(id)
    if (!session) return reply.status(404).send({ error: 'Session not found', code: 'NOT_FOUND' })
    return session
  })

  app.patch('/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const session = sessionService.get(id)
    if (!session) return reply.status(404).send({ error: 'Session not found', code: 'NOT_FOUND' })
    const updates = request.body as { name?: string; targetBranch?: string }
    sessionService.update(id, updates)
    return sessionService.get(id)
  })

  app.get('/sessions/:id/history', async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await sessionService.loadHistory(id)
      return { sessionId: id, status: 'loading' } // history arrives via WebSocket as bridge:history event
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message, code: 'HISTORY_FAILED' })
    }
  })

  app.delete('/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    await sessionService.destroy(id)
    return reply.status(204).send()
  })

  app.post('/sessions/:id/send', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { message, model, effort, permissionMode } = request.body as {
      message: string; model?: string; effort?: string; permissionMode?: string
    }
    try {
      await sessionService.send(id, message, { model, effort, permissionMode })
      return reply.status(202).send({ sessionId: id })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message, code: 'SEND_FAILED' })
    }
  })

  app.post('/sessions/:id/reply', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { toolUseID, decision } = request.body as { toolUseID: string; decision: 'allow' | 'deny' }
    sessionService.reply(id, toolUseID, decision)
    return { sessionId: id }
  })

  app.post('/sessions/:id/interrupt', async (request) => {
    const { id } = request.params as { id: string }
    sessionService.interrupt(id)
    return { sessionId: id, state: 'idle' }
  })

  app.post('/sessions/:id/stop', async (request) => {
    const { id } = request.params as { id: string }
    await sessionService.stop(id)
    return { sessionId: id, state: 'stopped' }
  })

  app.post('/sessions/:id/resume', async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await sessionService.resume(id)
      return sessionService.get(id)
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message, code: 'RESUME_FAILED' })
    }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/routes/session.routes.ts packages/backend/tests/routes/session.routes.test.ts
git commit -m "feat(backend): add session REST routes"
```

### Task 7.3: Git Routes

**Files:**
- Create: `packages/backend/src/routes/git.routes.ts`
- Create: `packages/backend/tests/routes/git.routes.test.ts`

- [ ] **Step 1: Write tests**

Follow the same TDD pattern as workspace/session routes. Each endpoint: write test with `buildApp()` + `inject()`, then implement. Use real temp repos from `createTestRepo()`.

Test each endpoint: POST checkout, verify branch changed via GET status. POST create branch, verify via GET branches. POST merge with a branch that has commits, verify merge via GET status. Test error cases: checkout non-existent branch, merge with conflicts.

- [ ] **Step 2: Implement git.routes.ts**

```typescript
// packages/backend/src/routes/git.routes.ts
import type { FastifyInstance } from 'fastify'
import type { WorkspaceService } from '../services/workspace.service'
import type { GitService } from '../services/git.service'

export function registerGitRoutes(app: FastifyInstance, workspaceService: WorkspaceService, gitService: GitService): void {
  // Helper to resolve workspace path
  async function getWorkspacePath(id: string): Promise<string> {
    const ws = await workspaceService.get(id)
    if (!ws) throw new Error('Workspace not found')
    return ws.path
  }

  app.get('/workspaces/:id/git/status', async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const path = await getWorkspacePath(id)
      return await gitService.getStatus(path)
    } catch (err) {
      return reply.status(404).send({ error: (err as Error).message, code: 'NOT_FOUND' })
    }
  })

  app.get('/workspaces/:id/git/branches', async (request, reply) => {
    const { id } = request.params as { id: string }
    const path = await getWorkspacePath(id)
    return await gitService.listBranches(path)
  })

  app.get('/workspaces/:id/git/worktrees', async (request, reply) => {
    const { id } = request.params as { id: string }
    const path = await getWorkspacePath(id)
    return await gitService.listWorktrees(path)
  })

  app.post('/workspaces/:id/git/checkout', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { branch, path: targetPath } = request.body as { branch: string; path?: string }
    const wsPath = await getWorkspacePath(id)
    try {
      await gitService.checkout(targetPath ?? wsPath, branch)
      return { status: 'ok', branch }
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message, code: 'CHECKOUT_FAILED' })
    }
  })

  app.post('/workspaces/:id/git/branch', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { name, from } = request.body as { name: string; from?: string }
    const path = await getWorkspacePath(id)
    try {
      await gitService.createBranch(path, name, from)
      return { status: 'ok', branch: name }
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message, code: 'BRANCH_FAILED' })
    }
  })

  app.post('/workspaces/:id/git/merge', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { source } = request.body as { source: string }
    const path = await getWorkspacePath(id)
    try {
      await gitService.merge(path, source)
      return { status: 'ok' }
    } catch (err) {
      return reply.status(409).send({ error: (err as Error).message, code: 'MERGE_CONFLICT' })
    }
  })

  app.post('/workspaces/:id/git/rebase', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { branch, onto } = request.body as { branch: string; onto: string }
    const path = await getWorkspacePath(id)
    try {
      await gitService.rebase(path, branch, onto)
      return { status: 'ok' }
    } catch (err) {
      return reply.status(409).send({ error: (err as Error).message, code: 'REBASE_CONFLICT' })
    }
  })
}
```

- [ ] **Step 3: Run tests to verify they pass**

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/routes/git.routes.ts packages/backend/tests/routes/git.routes.test.ts
git commit -m "feat(backend): add git REST routes"
```

### Task 7.4: WebSocket Handler

**Files:**
- Create: `packages/backend/src/routes/ws.routes.ts`
- Modify: `packages/backend/src/server.ts` — register all routes and wire services

- [ ] **Step 1: Implement WebSocket route**

```typescript
// packages/backend/src/routes/ws.routes.ts
import type { FastifyInstance } from 'fastify'
import type { EventBus } from '../infra/event-bus'
import type { SessionService } from '../services/session.service'

export function registerWSRoutes(
  app: FastifyInstance,
  eventBus: EventBus,
  sessionService: SessionService,
): void {
  app.get('/ws', { websocket: true }, (socket) => {
    // Subscribe to all session and git events
    const unsubs: Array<() => void> = []

    unsubs.push(eventBus.on('*', 'session:message', (data) => {
      socket.send(JSON.stringify({ event: 'session:message', ...(data as Record<string, unknown>) }))
    }))

    unsubs.push(eventBus.on('*', 'session:state', (data) => {
      socket.send(JSON.stringify({ event: 'session:state', ...(data as Record<string, unknown>) }))
    }))

    unsubs.push(eventBus.on('*', 'session:result', (data) => {
      socket.send(JSON.stringify({ event: 'session:result', ...(data as Record<string, unknown>) }))
    }))

    unsubs.push(eventBus.on('*', 'session:worktree-conflict', (data) => {
      socket.send(JSON.stringify({ event: 'session:worktree-conflict', ...(data as Record<string, unknown>) }))
    }))

    unsubs.push(eventBus.on('*', 'session:branch-mismatch', (data) => {
      socket.send(JSON.stringify({ event: 'session:branch-mismatch', ...(data as Record<string, unknown>) }))
    }))

    unsubs.push(eventBus.on('*', 'git:branch-changed', (data) => {
      socket.send(JSON.stringify({ event: 'git:branch-changed', ...(data as Record<string, unknown>) }))
    }))

    unsubs.push(eventBus.on('*', 'session:process-exit', (data) => {
      socket.send(JSON.stringify({ event: 'session:process-exit', ...(data as Record<string, unknown>) }))
    }))

    // Handle client commands
    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        switch (msg.command) {
          case 'session:send':
            sessionService.send(msg.sessionId, msg.data.message, msg.data)
            break
          case 'session:reply':
            sessionService.reply(msg.sessionId, msg.data.toolUseID, msg.data.decision)
            break
          case 'session:interrupt':
            sessionService.interrupt(msg.sessionId)
            break
        }
      } catch (err) {
        socket.send(JSON.stringify({ event: 'error', message: String(err) }))
      }
    })

    socket.on('close', () => {
      unsubs.forEach(u => u())
    })
  })
}
```

- [ ] **Step 2: Wire everything in server.ts**

Update `packages/backend/src/server.ts` to:
- Create all infrastructure (Store, EventBus, GitWatcher)
- Create all services (GitService, WorkspaceService, SessionService, ProcessManager)
- Register all route handlers
- Register `@fastify/websocket` plugin
- Register CORS for frontend dev server

- [ ] **Step 3: Verify full backend starts**

Run: `cd packages/backend && bun src/server.ts`
Expected: Server starts on :3101, `GET /health` and `GET /workspaces` work

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/routes/ws.routes.ts packages/backend/src/server.ts
git commit -m "feat(backend): add WebSocket handler and wire full server"
```

---

## Phase 8: Frontend Foundation

### Task 8.1: Nuxt Setup & Stores

**Files:**
- Create: `packages/frontend/app/stores/workspace.store.ts`
- Create: `packages/frontend/app/stores/session.store.ts`
- Create: `packages/frontend/app/composables/useWebSocket.ts`
- Create: `packages/frontend/app/composables/useMessageRegistry.ts`
- Create: `packages/frontend/app/types/index.ts`

- [ ] **Step 1: Create frontend types (re-export backend types + UI additions)**

```typescript
// packages/frontend/app/types/index.ts

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
```

- [ ] **Step 2: Create workspace store**

```typescript
// packages/frontend/app/stores/workspace.store.ts
export const useWorkspaceStore = defineStore('workspace', () => {
  const config = useRuntimeConfig()
  const workspaces = ref<Map<string, Workspace>>(new Map())
  const activeWorkspaceId = ref<string | null>(null)

  const activeWorkspace = computed(() =>
    activeWorkspaceId.value ? workspaces.value.get(activeWorkspaceId.value) ?? null : null
  )

  const sortedWorkspaces = computed(() =>
    Array.from(workspaces.value.values()).sort((a, b) =>
      new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime()
    )
  )

  async function fetchAll() {
    const data = await $fetch<Workspace[]>(`${config.public.backendUrl}/workspaces`)
    workspaces.value = new Map(data.map(ws => [ws.id, ws]))
  }

  async function open(path: string, name?: string) {
    const ws = await $fetch<Workspace>(`${config.public.backendUrl}/workspaces`, {
      method: 'POST',
      body: { path, name },
    })
    workspaces.value.set(ws.id, ws)
    activeWorkspaceId.value = ws.id
    return ws
  }

  async function close(id: string) {
    await $fetch(`${config.public.backendUrl}/workspaces/${id}`, { method: 'DELETE' })
    workspaces.value.delete(id)
    if (activeWorkspaceId.value === id) {
      activeWorkspaceId.value = sortedWorkspaces.value[0]?.id ?? null
    }
  }

  function setActive(id: string) {
    activeWorkspaceId.value = id
  }

  return { workspaces, activeWorkspaceId, activeWorkspace, sortedWorkspaces, fetchAll, open, close, setActive }
})
```

- [ ] **Step 3: Create session store**

```typescript
// packages/frontend/app/stores/session.store.ts
export const useSessionStore = defineStore('session', () => {
  const config = useRuntimeConfig()
  const sessions = ref<Map<string, Session>>(new Map())
  const messages = ref<Map<string, ChatMessage[]>>(new Map())
  const activeSessionByWorkspace = ref<Map<string, string>>(new Map())

  function activeSessionId(workspaceId: string): string | null {
    return activeSessionByWorkspace.value.get(workspaceId) ?? null
  }

  function sessionsForWorkspace(workspaceId: string): Session[] {
    return Array.from(sessions.value.values())
      .filter(s => s.workspaceId === workspaceId)
      .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime())
  }

  function messagesForSession(sessionId: string): ChatMessage[] {
    return messages.value.get(sessionId) ?? []
  }

  async function fetchForWorkspace(workspaceId: string) {
    const data = await $fetch<Session[]>(`${config.public.backendUrl}/workspaces/${workspaceId}/sessions`)
    for (const s of data) {
      sessions.value.set(s.id, s)
    }
  }

  async function create(workspaceId: string, opts: { name: string; sourceBranch: string; targetBranch: string; useWorktree: boolean }) {
    const session = await $fetch<Session>(`${config.public.backendUrl}/workspaces/${workspaceId}/sessions`, {
      method: 'POST',
      body: opts,
    })
    sessions.value.set(session.id, session)
    activeSessionByWorkspace.value.set(workspaceId, session.id)
    return session
  }

  async function send(sessionId: string, message: string, opts: { model?: string; effort?: string } = {}) {
    await $fetch(`${config.public.backendUrl}/sessions/${sessionId}/send`, {
      method: 'POST',
      body: { message, ...opts },
    })
  }

  async function reply(sessionId: string, toolUseID: string, decision: 'allow' | 'deny') {
    await $fetch(`${config.public.backendUrl}/sessions/${sessionId}/reply`, {
      method: 'POST',
      body: { toolUseID, decision },
    })
  }

  async function interrupt(sessionId: string) {
    await $fetch(`${config.public.backendUrl}/sessions/${sessionId}/interrupt`, { method: 'POST' })
  }

  function setActive(workspaceId: string, sessionId: string) {
    activeSessionByWorkspace.value.set(workspaceId, sessionId)
  }

  // Called by WebSocket handler when session:message arrives
  function appendMessage(sessionId: string, raw: Record<string, unknown>) {
    if (!messages.value.has(sessionId)) {
      messages.value.set(sessionId, [])
    }
    messages.value.get(sessionId)!.push({
      id: crypto.randomUUID(),
      sessionId,
      timestamp: new Date().toISOString(),
      raw,
    })
  }

  // Called by WebSocket handler when session state changes
  function updateState(sessionId: string, state: SessionState) {
    const session = sessions.value.get(sessionId)
    if (session) {
      session.state = state
    }
  }

  return {
    sessions, messages, activeSessionByWorkspace,
    activeSessionId, sessionsForWorkspace, messagesForSession,
    fetchForWorkspace, create, send, reply, interrupt, setActive,
    appendMessage, updateState,
  }
})
```

- [ ] **Step 4: Create WebSocket composable**

```typescript
// packages/frontend/app/composables/useWebSocket.ts
export function useWebSocket() {
  const config = useRuntimeConfig()
  const sessionStore = useSessionStore()
  const connected = ref(false)
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectDelay = 1000

  function connect() {
    ws = new WebSocket(config.public.wsUrl)

    ws.onopen = () => {
      connected.value = true
      reconnectDelay = 1000
    }

    ws.onclose = () => {
      connected.value = false
      scheduleReconnect()
    }

    ws.onerror = () => {
      ws?.close()
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        handleEvent(msg)
      } catch { /* ignore non-JSON */ }
    }
  }

  function handleEvent(msg: Record<string, unknown>) {
    const sessionId = msg.sessionId as string | undefined

    switch (msg.event) {
      case 'session:message':
        if (sessionId) sessionStore.appendMessage(sessionId, msg)
        break
      case 'session:state':
        if (sessionId) {
          const data = msg.data as { to: string }
          sessionStore.updateState(sessionId, data.to as SessionState)
        }
        break
      // Additional event handlers added as needed
    }
  }

  function send(command: Record<string, unknown>) {
    ws?.send(JSON.stringify(command))
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(() => {
      connect()
      reconnectDelay = Math.min(reconnectDelay * 2, 30000)
    }, reconnectDelay)
  }

  function disconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    ws?.close()
    ws = null
  }

  return { connected, connect, disconnect, send }
}
```

- [ ] **Step 5: Create message registry composable**

```typescript
// packages/frontend/app/composables/useMessageRegistry.ts
import type { Component } from 'vue'

// Lazy imports — components registered when they exist
const registry: Record<string, Component> = {}

export function useMessageRegistry() {
  function register(type: string, component: Component) {
    registry[type] = component
  }

  function getComponent(type: string): Component | null {
    return registry[type] ?? null
  }

  return { register, getComponent }
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/app/
git commit -m "feat(frontend): add stores, WebSocket composable, and message registry"
```

---

## Phase 9: Frontend Components

**Implementation note:** Frontend component tasks provide structure and NuxtUI component choices rather than copy-paste code. This is intentional — Vue component implementation depends on the exact NuxtUI v4 API which should be looked up via the `nuxt-ui-remote` MCP at implementation time. The implementer should: (1) check the NuxtUI docs for each component's props/slots, (2) build components that are thin wrappers around NuxtUI primitives, (3) keep business logic in stores, not components. Each component should have a corresponding test file in `packages/frontend/tests/components/` using `@vue/test-utils`.

### Task 9.1: Workspace Components

**Files:**
- Create: `packages/frontend/app/components/workspace/WorkspaceTabBar.vue`
- Create: `packages/frontend/app/components/workspace/WorkspaceView.vue`
- Create: `packages/frontend/app/components/workspace/WorkspaceSelector.vue`
- Modify: `packages/frontend/app/app.vue`

- [ ] **Step 1: Implement WorkspaceTabBar**

Uses `UTabs` from NuxtUI. Shows workspace tabs + "+" button to open new workspace.

- [ ] **Step 2: Implement WorkspaceSelector**

Uses `UModal` + file path input. Calls `workspaceStore.open(path)`.

- [ ] **Step 3: Implement WorkspaceView**

Container that renders the SessionTabBar + active SessionView for the current workspace.

- [ ] **Step 4: Wire into app.vue**

```vue
<!-- packages/frontend/app/app.vue -->
<template>
  <UApp>
    <div class="flex flex-col h-screen">
      <WorkspaceTabBar />
      <div class="flex-1 overflow-hidden">
        <WorkspaceView
          v-if="workspaceStore.activeWorkspace"
          :workspace="workspaceStore.activeWorkspace"
        />
        <div v-else class="flex items-center justify-center h-full">
          <WorkspaceSelector />
        </div>
      </div>
    </div>
  </UApp>
</template>

<script setup lang="ts">
const workspaceStore = useWorkspaceStore()
const { connect } = useWebSocket()

onMounted(() => {
  workspaceStore.fetchAll()
  connect()
})
</script>
```

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/
git commit -m "feat(frontend): add workspace components and tab bar"
```

### Task 9.2: Session Components

**Files:**
- Create: `packages/frontend/app/components/session/SessionTabBar.vue`
- Create: `packages/frontend/app/components/session/SessionView.vue`
- Create: `packages/frontend/app/components/session/SessionHeader.vue`
- Create: `packages/frontend/app/components/session/NewSessionDialog.vue`

- [ ] **Step 1: Implement SessionTabBar**

Uses `UTabs`. Shows session tabs per workspace + "+" button to create new session.

- [ ] **Step 2: Implement NewSessionDialog**

Uses `UModal` with form: name, source branch, target branch, use worktree toggle.

- [ ] **Step 3: Implement SessionHeader**

Shows: source branch -> target branch, state badge (`UBadge`), accumulated cost/tokens.

- [ ] **Step 4: Implement SessionView**

Container: SessionHeader + ChatHistory + PromptBox.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/components/session/
git commit -m "feat(frontend): add session components, tabs, and header"
```

### Task 9.3: Chat Components

**Files:**
- Create: `packages/frontend/app/components/chat/ChatHistory.vue`
- Create: `packages/frontend/app/components/chat/AssistantMessage.vue`
- Create: `packages/frontend/app/components/chat/UserMessage.vue`
- Create: `packages/frontend/app/components/chat/ToolInvocation.vue`
- Create: `packages/frontend/app/components/chat/ToolApprovalBar.vue`
- Create: `packages/frontend/app/components/chat/ThinkingBlock.vue`
- Create: `packages/frontend/app/components/chat/SystemMessage.vue`
- Create: `packages/frontend/app/components/chat/ErrorNotice.vue`
- Create: `packages/frontend/app/components/chat/GenericMessage.vue`

- [ ] **Step 1: Implement ChatHistory**

Scrollable list that iterates over `sessionStore.messagesForSession(sessionId)` and renders each message through the registry. Uses `UChatMessages` from NuxtUI as the container where possible, with custom rendering for SDK-specific message types.

- [ ] **Step 2: Implement AssistantMessage**

Renders assistant messages. Iterates over content blocks — delegates to TextBlock (rendered markdown), ToolInvocation, ThinkingBlock based on block type. Uses `UChatMessage` for the wrapper.

- [ ] **Step 3: Implement UserMessage**

Renders user messages. Uses `UChatMessage` with appropriate variant.

- [ ] **Step 4: Implement ToolInvocation**

Collapsible (`UChatTool`) showing tool name, input, and result. Expandable to see full details.

- [ ] **Step 5: Implement ToolApprovalBar**

Shown when `session:tool-confirmation` event is pending. Two buttons: Allow / Deny. Calls `sessionStore.reply()`.

- [ ] **Step 6: Implement ThinkingBlock**

Collapsible block using `UChatReasoning` for extended thinking content.

- [ ] **Step 7: Implement remaining message components**

SystemMessage (uses `UAlert`), ErrorNotice (uses `UAlert` with error variant), GenericMessage (renders raw JSON in a code block).

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/app/components/chat/
git commit -m "feat(frontend): add chat message components with NuxtUI primitives"
```

### Task 9.4: Prompt Components

**Files:**
- Create: `packages/frontend/app/components/prompt/PromptBox.vue`
- Create: `packages/frontend/app/components/prompt/PromptToolbar.vue`

- [ ] **Step 1: Implement PromptBox**

Uses `UChatPrompt` for the textarea + `UChatPromptSubmit` for the send button. Keyboard shortcuts: Enter to send, Shift+Enter for newline, Esc to interrupt. Disabled when waiting for tool approval. Shows "Interrupt" button during active query.

- [ ] **Step 2: Implement PromptToolbar**

Row of `USelect` dropdowns: model (sonnet/opus/haiku), effort (low/medium/high/max), permission mode. Values saved to localStorage per workspace, restored on mount.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/app/components/prompt/
git commit -m "feat(frontend): add prompt box with keyboard shortcuts and toolbar"
```

---

### Task 9.5: Frontend Store Tests

**Files:**
- Create: `packages/frontend/tests/stores/workspace.store.test.ts`
- Create: `packages/frontend/tests/stores/session.store.test.ts`

- [ ] **Step 1: Write workspace store tests**

Test with mocked `$fetch` (using `vi.mock` or `msw`):
- `fetchAll()` populates workspaces map
- `open()` adds workspace and sets it active
- `close()` removes workspace, selects next active
- `setActive()` updates activeWorkspaceId
- Computed `sortedWorkspaces` sorts by lastOpenedAt

- [ ] **Step 2: Write session store tests**

Test with mocked `$fetch`:
- `create()` adds session and sets active
- `appendMessage()` accumulates messages
- `updateState()` updates session state
- `sessionsForWorkspace()` filters correctly
- `messagesForSession()` returns correct messages

- [ ] **Step 3: Run frontend tests**

Run: `cd packages/frontend && pnpm test`
Expected: All store tests PASS

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/tests/
git commit -m "test(frontend): add Pinia store unit tests"
```

---

## Phase 10: Integration Testing

### Task 10.1: Backend Integration Test

Full-stack backend test: create workspace, create session, verify git context flows correctly.

**Files:**
- Create: `packages/backend/tests/integration/full-flow.test.ts`

- [ ] **Step 1: Write integration test**

Test the full flow using Fastify's `.inject()`:
1. `POST /workspaces` with a real test repo
2. `GET /workspaces/:id` — verify branch is returned
3. `POST /workspaces/:id/sessions` with `useWorktree: true`
4. Verify worktree was created via `GET /workspaces/:id/git/worktrees`
5. `DELETE /sessions/:id` — verify worktree is cleaned up
6. `DELETE /workspaces/:id` — verify cleanup

- [ ] **Step 2: Run integration test**

Run: `cd packages/backend && bun test tests/integration/full-flow.test.ts`
Expected: All steps PASS

- [ ] **Step 3: Commit**

```bash
git add packages/backend/tests/integration/
git commit -m "test(backend): add full-flow integration test"
```

### Task 10.2: Run Full Test Suite

- [ ] **Step 1: Run all backend tests**

Run: `task test:backend`
Expected: All tests PASS

- [ ] **Step 2: Run all frontend tests**

Run: `task test:frontend`
Expected: All tests PASS (or skip if no frontend unit tests yet)

- [ ] **Step 3: Run lint**

Run: `task lint:check`
Expected: Zero errors

- [ ] **Step 4: Verify dev mode works**

Run: `task dev` (starts both backend and frontend)
Expected: Backend on :3101, Frontend on :3100, frontend loads and shows workspace selector

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: iteration 1 complete — backend services, routes, frontend scaffold"
```

---

## Summary

| Phase | What it builds | Tests |
|-------|---------------|-------|
| 0 | Monorepo scaffold, Taskfile, server skeleton | Manual verification |
| 1 | EventBus, SQLite Store | 12+ unit tests |
| 2 | GitService (branches, worktrees, status) | 6+ unit tests with real repos |
| 3 | GitWatcher (filesystem watching) | 2+ integration tests with real repos |
| 4 | Session Bridge (SDK <-> stdio) | 2+ protocol tests |
| 5 | ProcessManager (child process lifecycle) | 3+ lifecycle tests |
| 6 | WorkspaceService, SessionService | 10+ unit + integration tests |
| 7 | REST routes + WebSocket handler | 10+ HTTP-level tests |
| 8 | Frontend stores, composables, types | Store logic (if tested) |
| 9 | All Vue components + store tests | Pinia store unit tests + component tests |
| 10 | Full-flow integration | End-to-end backend test |

Total: ~10 phases, ~17 tasks, ~70+ steps, ~60+ automated tests
