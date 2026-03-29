# OnCraft Remake — Architecture Overview

**Last updated:** 2026-03-29
**Status:** Living document — reflects current implementation state

---

## 1. System Overview

OnCraft Remake is a monorepo with two packages: a **Bun/Fastify backend** and a **Nuxt 4 SPA frontend**. The backend is the product — the frontend is a replaceable consumer of its REST + WebSocket API.

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (Nuxt 4 SPA)            │
│   Pinia stores ← useWebSocket() → REST client      │
└──────────┬────────────────────────┬──────────────────┘
           │ WebSocket              │ HTTP
           │ (events)              │ (CRUD)
┌──────────▼────────────────────────▼──────────────────┐
│                    Backend (Fastify on Bun)          │
│                                                      │
│  Routes ──▶ Services ──▶ Infrastructure              │
│                │                                     │
│                ▼                                     │
│         ProcessManager ──▶ Bridge child processes    │
│              (one per active session)                │
│                │                                     │
│                ▼                                     │
│         Claude Agent SDK                             │
└──────────────────────────────────────────────────────┘
```

---

## 2. Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Runtime** | Bun | Native TS, built-in SQLite/WebSocket, fast startup |
| **Framework** | Fastify | Routing, schema validation, plugin ecosystem |
| **Database** | `bun:sqlite` | Built-in, zero deps, synchronous API |
| **Git** | `simple-git` | Wraps git CLI, worktree/branch/merge support |
| **File watching** | `chokidar` | Mature cross-platform fs watching |
| **Claude SDK** | `@anthropic-ai/claude-agent-sdk` | Official SDK for Claude Code sessions |
| **Frontend** | Nuxt 4 (SPA mode) | Vue 3 + file-based routing |
| **UI** | NuxtUI v4 + Tailwind | Chat components, dashboard primitives |
| **State** | Pinia | Standard Vue/Nuxt state management |
| **Package manager** | pnpm | Monorepo workspace support |
| **Task runner** | Taskfile | Cross-package dev/test/lint/build commands |

---

## 3. Backend Architecture

### 3.1 Layer Diagram

```
Routes (HTTP + WebSocket handlers)
  │
  ▼
Services (domain logic)
  ├── RepositoryService   — repo CRUD, GitWatcher lifecycle
  ├── SessionService      — session CRUD, ProcessManager orchestration
  ├── ProjectService      — project config (minimal)
  └── GitService          — git operations (branches, worktrees, merge)
  │
  ▼
Infrastructure
  ├── Store (SQLite)      — persistence for repos, sessions, project
  ├── EventBus            — path-based pub/sub
  ├── GitWatcher          — chokidar watches .git/HEAD, emits events
  └── ProcessManager      — spawns/manages bridge child processes
        │
        ▼
      Bridge (session-bridge.ts)
        │
        ▼
      Claude Agent SDK
```

### 3.2 Services

**RepositoryService** (`services/repository.service.ts`)
- `open(path, name?)` — validates git repo, creates DB record, starts GitWatcher
- `close(id)` — stops watcher, cascades to sessions
- `get(id)` — returns repo with live branch (read from git, not DB)
- `list()` — all repositories

**SessionService** (`services/session.service.ts`)
- `create(repositoryId, opts)` — creates session, optionally creates git worktree
- `send(sessionId, message, opts?)` — spawns bridge if needed, sends message
- `reply(sessionId, toolUseID, decision)` — resolves tool approval
- `interrupt(sessionId)` — aborts active query, keeps process alive
- `stop(sessionId)` — kills bridge process
- `resume(sessionId)` — reconnects via `claudeSessionId`
- `loadHistory(sessionId)` — fetches SDK message history
- `destroy(sessionId)` — kills process, removes worktree, deletes record
- Subscribes to EventBus for git changes and process exits
- Manages session state machine transitions

**ProjectService** (`services/project.service.ts`)
- `get()` — returns project or null
- `getOrCreate(name)` — creates if needed
- `update(fields)` — updates project metadata

**GitService** (`services/git.service.ts`)
- All operations are path-scoped (work on any worktree)
- `getBranch(path)`, `getStatus(path)`, `listBranches(path)`
- `createWorktree()`, `removeWorktree()`, `listWorktrees()`
- `checkout()`, `createBranch()`, `merge()`, `rebase()`

### 3.3 Infrastructure

**Store** (`infra/store.ts`)
- SQLite via `bun:sqlite`
- Tables: `repositories`, `sessions`, `project`
- No message storage — messages live in SDK history (`~/.claude/sessions/`)
- Schema created on startup (no migrations — delete DB to reset during early dev)

**EventBus** (`infra/event-bus.ts`)
- Path-based pub/sub (topics keyed by filesystem path)
- Wildcard `*` path for global subscriptions
- Zero domain knowledge — purely infrastructure

**GitWatcher** (`infra/git-watcher.ts`)
- Per-repository chokidar watcher on `.git/HEAD` and `.git/refs/`
- Detects branch changes, emits `repository:git-changed` on EventBus
- Has no knowledge of sessions or repositories — purely path-based

**ProcessManager** (`services/process-manager.ts`)
- Spawns one `bun session-bridge.ts` child process per active session
- Reads stdout line-by-line, parses JSON, emits on EventBus as `session:message`
- Captures stderr as `bridge:stderr` events
- Handles process exit → `session:process-exit` event
- `waitForReady()` blocks until bridge emits `bridge:ready`

### 3.4 Session Bridge

`bridge/session-bridge.ts` is a standalone Bun script that runs as a child process. It bridges stdin/stdout JSON-lines to the Claude Agent SDK.

**Input (stdin JSON-lines):**
- `start` — begin query or enqueue follow-up message
- `reply` — resolve tool approval (`toolUseID` + `allow`/`deny`)
- `interrupt` — abort current query
- `stop` — clean shutdown
- `loadHistory` — fetch SDK message history

**Output (stdout JSON-lines):**
- Raw SDK events forwarded unmodified
- `bridge:ready` — process initialized
- `bridge:error` — error occurred
- `bridge:history` — message history response
- `tool_confirmation` — tool approval request (from `canUseTool` callback)

**Key internals:**
- `MessageStream` — AsyncIterable that feeds user messages into SDK's `query()` loop
- Deferred promise pattern for tool approvals (keyed by SDK's `toolUseID`)
- Processes stay alive between queries to avoid re-initialization
- Passes `settingSources: ['user', 'project', 'local']` so SDK loads CLAUDE.md, MCP servers, etc.

### 3.5 Session State Machine

```
create() → IDLE (no process)
    │
    send() → STARTING (spawning bridge)
    │
    bridge:ready → ACTIVE (query running)
    │                ↑
    │          send() enqueues into MessageStream
    │
    result → IDLE (process alive, waiting)
    │
    stop() → STOPPED (process killed, record preserved)
    │
    resume() → IDLE (ready for next send)

  ERROR (crash) ──resume()──→ IDLE
  any ──destroy()──→ (deleted)
```

### 3.6 Event Flow

```
GitWatcher detects .git/HEAD change at path X
    │
    ▼
EventBus: { event: "repository:git-changed", path: X, from, to }
    │
    ├──▶ SessionService
    │       ├── Active session: interrupt, inject system message
    │       └── Idle session: flag mismatch for next interaction
    │
    ├──▶ RepositoryService
    │       └── Update state, notify dependent sessions
    │
    └──▶ WebSocket handler → enriches with IDs → frontend
```

---

## 4. API Surface

### 4.1 REST Endpoints

**Project** (singular — one per instance)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/project` | Get project info |
| `PATCH` | `/project` | Update project settings |

**Repositories**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/repositories` | Add repository `{ path, name? }` |
| `GET` | `/repositories` | List all repositories |
| `GET` | `/repositories/:id` | Get repository (includes live branch) |
| `DELETE` | `/repositories/:id` | Close repository |

**Sessions**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/repositories/:id/sessions` | Create session |
| `GET` | `/repositories/:id/sessions` | List sessions for repository |
| `GET` | `/sessions/:id` | Get session |
| `PATCH` | `/sessions/:id` | Update metadata |
| `DELETE` | `/sessions/:id` | Destroy session |
| `POST` | `/sessions/:id/send` | Send message (→ 202, response via WS) |
| `POST` | `/sessions/:id/reply` | Reply to tool approval |
| `POST` | `/sessions/:id/interrupt` | Interrupt active query |
| `POST` | `/sessions/:id/stop` | Stop session process |
| `POST` | `/sessions/:id/resume` | Resume session |
| `GET` | `/sessions/:id/history` | Load message history |

**Git** (namespaced under repository)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/repositories/:id/git/status` | Git status |
| `GET` | `/repositories/:id/git/branches` | List branches |
| `GET` | `/repositories/:id/git/worktrees` | List worktrees |
| `POST` | `/repositories/:id/git/checkout` | Checkout branch |
| `POST` | `/repositories/:id/git/branch` | Create branch |
| `POST` | `/repositories/:id/git/merge` | Merge branches |
| `POST` | `/repositories/:id/git/rebase` | Rebase branch |

### 4.2 WebSocket Protocol

Single multiplexed connection at `/ws`.

**Server → Client:**
```
session:message          — raw SDK event passthrough
session:state-changed    — state transition { from, to }
session:result           — query completed with metrics
session:tool-confirmation — tool approval needed
repository:git-changed   — branch change detected
```

**Client → Server:**
```
session:send      — send message to session
session:reply     — approve/deny tool use
session:interrupt — interrupt active query
```

---

## 5. Frontend Architecture

### 5.1 Component Hierarchy

```
app.vue
└── RepositoryTabBar         — top-level repo tabs
    └── RepositoryView       — container for one repository
        └── SessionTabBar    — session tabs within repo
            └── SessionView  — header + chat + prompt
                ├── SessionHeader     — branches, state, cost
                ├── ChatHistory       — scrollable message list
                │   ├── UserMessage
                │   ├── AssistantMessage (renders content blocks)
                │   ├── ToolInvocation
                │   ├── ToolApprovalBar
                │   ├── ThinkingBlock
                │   ├── SystemMessage
                │   ├── ErrorNotice
                │   └── GenericMessage (fallback for unknown types)
                └── PromptBox
                    └── PromptToolbar (model, effort selectors)
```

### 5.2 State Management (Pinia)

| Store | Responsibility |
|-------|---------------|
| `useRepositoryStore` | Repository CRUD, active repo tracking |
| `useSessionStore` | Session CRUD, in-memory message history, active session per repo |
| `useProjectStore` | Project info fetch/update |

### 5.3 WebSocket Client

`useWebSocket()` composable:
- Connects on app mount, auto-reconnects with exponential backoff (1s → 30s max)
- Parses incoming events, dispatches to correct Pinia store
- Exposes `send()` for client → server commands
- Provides `connected` ref for UI status indicator

### 5.4 Message Rendering

SDK messages are rendered via two registries:

1. **Message type registry** — maps top-level SDK message types (`assistant`, `user`, `system`, `result`, etc.) to Vue components
2. **Content block registry** — maps content blocks within assistant messages (`text`, `tool_use`, `tool_result`, `thinking`) to Vue components

Unknown types/blocks fall back to generic JSON renderers.

---

## 6. Data Flow: Send Message

End-to-end flow when the user sends a message:

```
1. User types in PromptBox, presses Enter
2. Frontend POSTs to /sessions/:id/send { message, model, effort }
3. SessionService checks state, gets repo path
4. If no bridge process: spawns via ProcessManager, waits for bridge:ready
5. Sets state → ACTIVE, sends { cmd: "start", prompt, ... } to bridge stdin
6. Bridge enqueues message into MessageStream
7. SDK's query() consumes from MessageStream, starts streaming
8. SDK emits events → bridge writes JSON to stdout
9. ProcessManager reads stdout → emits on EventBus as session:message
10. WebSocket handler forwards to frontend
11. useWebSocket() dispatches to sessionStore.appendMessage()
12. ChatHistory re-renders with new message components
13. On SDK result event → SessionService updates metrics, sets state → IDLE
```

---

## 7. Data Flow: Tool Approval

```
1. SDK calls canUseTool(toolName, toolInput, { toolUseID })
2. Bridge emits { type: "tool_confirmation", toolUseID, ... } to stdout
3. ProcessManager → EventBus → WebSocket → frontend
4. Frontend renders ToolApprovalBar with Allow/Deny buttons
5. User clicks Allow
6. Frontend sends { command: "session:reply", toolUseID, decision: "allow" }
7. WebSocket handler → SessionService.reply() → ProcessManager.send()
8. Bridge receives { cmd: "reply", toolUseID, decision }
9. Bridge resolves deferred promise → SDK proceeds with tool execution
```

---

## 8. Project Structure

```
oncraft-remake/
├── packages/
│   ├── backend/
│   │   ├── src/
│   │   │   ├── server.ts              # App setup, route registration, startup
│   │   │   ├── types/index.ts         # Domain types (Repository, Session, Project)
│   │   │   ├── infra/
│   │   │   │   ├── store.ts           # SQLite CRUD
│   │   │   │   ├── event-bus.ts       # Path-based pub/sub
│   │   │   │   └── git-watcher.ts     # Filesystem watcher
│   │   │   ├── services/
│   │   │   │   ├── repository.service.ts
│   │   │   │   ├── session.service.ts
│   │   │   │   ├── project.service.ts
│   │   │   │   ├── git.service.ts
│   │   │   │   └── process-manager.ts
│   │   │   ├── routes/
│   │   │   │   ├── repository.routes.ts
│   │   │   │   ├── session.routes.ts
│   │   │   │   ├── project.routes.ts
│   │   │   │   ├── git.routes.ts
│   │   │   │   └── ws.routes.ts
│   │   │   └── bridge/
│   │   │       └── session-bridge.ts  # Child process: SDK <-> JSON-lines
│   │   └── tests/                     # Mirrors src/ structure
│   └── frontend/
│       ├── app/
│       │   ├── app.vue
│       │   ├── types/index.ts
│       │   ├── stores/
│       │   │   ├── repository.store.ts
│       │   │   ├── session.store.ts
│       │   │   └── project.store.ts
│       │   ├── composables/
│       │   │   ├── useWebSocket.ts
│       │   │   └── useMessageRegistry.ts
│       │   └── components/
│       │       ├── repository/        # RepositoryTabBar, Selector, View
│       │       ├── session/           # SessionTabBar, View, Header, NewSessionDialog
│       │       ├── chat/              # ChatHistory, message type components
│       │       └── prompt/            # PromptBox, PromptToolbar
│       └── tests/                     # Store and component tests
├── Taskfile.yml                       # dev, test, lint, build
├── pnpm-workspace.yaml
└── AGENTS.md
```

---

## 9. Implementation Status

### Implemented (Iteration 1 — partial)

| Component | Status | Notes |
|-----------|--------|-------|
| Store (SQLite) | Done | repositories, sessions, project tables |
| EventBus | Done | Path-based pub/sub with wildcard |
| GitWatcher | Done | chokidar on .git/HEAD, emits events |
| GitService | Done | Full git operations via simple-git |
| RepositoryService | Done | CRUD + watcher lifecycle |
| SessionService | Done | Full lifecycle including worktree conflicts |
| ProjectService | Done | Minimal get/update |
| ProcessManager | Done | Spawn, send, stop, readLines, waitForReady |
| Session Bridge | Done | SDK query, tool approval, message stream, history |
| All REST routes | Done | Repositories, sessions, project, git |
| WebSocket routes | Done | Event multiplexing, command handling |
| Repository UI | Done | Tab bar, selector (add form), view |
| Session UI | Done | Tab bar, new dialog, header, view |
| Chat components | Done | All message types + generic fallback |
| Prompt components | Done | PromptBox + PromptToolbar |
| WebSocket client | Done | Auto-reconnect, event dispatch |
| Pinia stores | Done | Repository, session, project |

### Not Yet Implemented

| Component | Iteration | Notes |
|-----------|-----------|-------|
| Send message → bridge | 1 (remaining) | UI wired, backend wired, not yet tested end-to-end with real SDK |
| Git UI panel | 2 | Branch visualization, worktree management |
| Dashboard layout | 3 | UDashboardGroup panels, resizable |
| Workflow engine | 4 | State machines, hooks, kanban |
| MCP server | Post-4 | Expose project/repo/session to external agents |

---

## 10. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Child process per session** (not in-process SDK) | Clean kill semantics, state encapsulation, stable stdin/stdout protocol. One extra process layer is negligible for <20 sessions. |
| **Path-based EventBus** (not entity-ID-based) | GitWatcher has zero domain knowledge — it watches filesystem paths. Services subscribe to paths they care about and correlate to their entities. |
| **No message persistence** | SDK owns message history in `~/.claude/sessions/`. OnCraft fetches via `getSessionMessages()` on demand. No duplication. |
| **SQLite, no migrations** | Early development — delete DB and recreate. Migration infrastructure deferred until schema stabilizes. |
| **Single WebSocket** | One multiplexed connection carries all session events. Simpler than per-session connections. Events tagged with `sessionId`/`repositoryId` for routing. |
| **SDK passthrough** | Backend forwards raw SDK events without transformation. Frontend renders known types with dedicated components, unknown types with generic fallback. No feature loss from SDK updates. |
| **`/project` is singular** | One project per OnCraft instance. No `/projects/:id` collection. |
