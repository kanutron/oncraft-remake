# OnCraft Remake — Design Specification

> A web-based tool for managing parallel Claude Code sessions across git repositories, with explicit git context per session and transparent SDK passthrough.
>
> **Note:** The domain model was updated from `Workspace > Session` to `Project > Repository > Session` via the terminology rename spec (`.context/agents/spec/terminology-rename/design.md`). All "workspace" references below have been updated to "repository" accordingly. The word "workspace" is retained only where it refers to external concepts (pnpm workspaces, git worktrees as workspaces, VS Code workspaces).

## Problem Statement

Existing tools for managing Claude Code sessions (e.g., apuigsech/oncraft) suffer from unclear session-to-git-state relationships. Sessions don't declare which branch they work on, which branch they target, or which worktree they operate in. This leads to collisions between agents, accidental work on wrong branches, and muddled merge workflows.

**OnCraft Remake** solves this by making every session's git context first-class: each session explicitly declares its source branch, target branch, and worktree — and the tool actively monitors git state to detect and surface mismatches.

## Core Principles

1. **Backend is the product** — the Nuxt frontend is a replaceable UI consumer
2. **SDK passthrough to frontend** — Claude Agent SDK events flow to the frontend unmodified; no feature loss. The backend may inject system-level context *to the agent* (e.g., git state change warnings) but never transforms what the frontend receives from the SDK.
3. **Sessions own their git context** — sourceBranch, targetBranch, worktreePath are first-class fields
4. **Git state is observed, not assumed** — a file watcher detects changes regardless of who made them (agent, user via CLI, user via UI)
5. **Path-based pub/sub** — GitWatcher emits events by filesystem path; services subscribe to paths they care about
6. **Parallel sessions** — one child process per active session, each isolated in its own worktree
7. **Extensible event model** — the bridge forwards all SDK event types (known and future); the frontend renders known types with dedicated components and unknown types with a generic fallback

## Architecture

### Overview

Monorepo with two packages: a standalone Fastify backend and a Nuxt SPA frontend.

```
Frontend (Nuxt SPA)  ──HTTP/WS──▶  Backend (Fastify)
                                       │
                              ┌────────┼────────┐
                              │        │        │
                         Services   Infra    Bridge
                              │        │        │
                    ┌─────────┤    ┌───┤    ┌───┤
                    │         │    │   │    │   │
              Repository Session  Git │  Event │  Process  Store  GitWatcher
              Service   Service  Svc  │  Bus   │  Manager
                                      │        │
                                      │   session-bridge.ts
                                      │   (child process ↔ SDK)
                                      │
                                   SQLite
```

### Communication

- **REST API** for CRUD operations (repositories, sessions, git actions)
- **WebSocket** (single multiplexed connection) for streaming events (Claude responses, git state changes, session state transitions)
- Both REST and WebSocket available for session commands (send, reply, interrupt) — REST for programmatic use, WebSocket for real-time UI interactions

## Domain Model

The domain model is **Project > Repository > Session**.

### Repository

A repository is OnCraft's enriched representation of a git repo — wraps a git repository path with orchestration state.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Unique identifier |
| `path` | string | Absolute path to repo root (main worktree) |
| `name` | string | Display name (defaults to directory name) |
| `branch` | string | Current branch of main worktree (read live via `GitService.getBranch()` on every `GET` request; also kept in sync by GitWatcher events on the main worktree path — not persisted in SQLite) |
| `createdAt` | ISO timestamp | When repository was first opened |
| `lastOpenedAt` | ISO timestamp | Last time repository was activated |

### Session

A session is a Claude Code conversation bound to a specific git context within a repository.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Our internal ID |
| `repositoryId` | string | Parent repository |
| `claudeSessionId` | string \| null | SDK's session ID (null until first query) |
| `name` | string | User-assigned or auto-generated |
| `sourceBranch` | string | Branch this session works on (e.g., `feat/auth`) |
| `targetBranch` | string | Branch where work should merge/PR to (e.g., `dev`) |
| `worktreePath` | string \| null | Absolute path to worktree (null = main worktree) |
| `state` | enum | `idle` \| `starting` \| `active` \| `stopped` \| `error` \| `completed` |
| `createdAt` | ISO timestamp | |
| `lastActivityAt` | ISO timestamp | |
| `costUsd` | number | Accumulated cost |
| `inputTokens` | number | Accumulated input tokens |
| `outputTokens` | number | Accumulated output tokens |

### Rules

- `sourceBranch` is observed from git but also expected — a mismatch triggers a state event
- `targetBranch` is user-declared intent (metadata, not enforced by git)
- `worktreePath` null means the session uses the main worktree. Multiple sessions can share the same worktree (main or dedicated). When a session transitions to `active`, the backend checks if another session on the same worktree is also `active` — if so, emits a `session:worktree-conflict` warning event to the frontend. The user decides whether to proceed, interrupt the other session, or cancel. No hard rejection at creation time.
- `claudeSessionId` is populated after the first SDK query, enabling resume
- State meanings: `idle` (no active query, process may or may not be alive), `starting` (child process spawning), `active` (query running), `stopped` (process killed, session preserved for future resume), `error` (process crashed or SDK error), `completed` (user or agent marked work as done)
- Multiple sessions can be `active` simultaneously (parallel Claude queries)

### Relationships

- Repository has many Sessions (1:N)
- Session belongs to exactly one Repository
- Session may have its own worktree or share the main worktree

## Backend Architecture

### Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Native TypeScript, built-in SQLite/WebSocket, fast startup, single-binary compilation for distribution |
| Framework | Fastify (on Bun) | Routing, schema validation, plugin ecosystem; runs on Bun's Node-compatible runtime. May evaluate dropping for `Bun.serve()` if framework adds no value. |
| Database | `bun:sqlite` | Built-in, stable, zero deps, synchronous API |
| Git operations | `simple-git` | Wraps git CLI, supports worktrees/branches/merge/rebase |
| File watching | `chokidar` | Mature, cross-platform fs watching |
| Claude SDK | `@anthropic-ai/claude-agent-sdk` | Official SDK for Claude Code session management |
| Package manager | pnpm | Monorepo workspace support; Bun is the runtime, pnpm manages packages |

### Service Layer

**RepositoryService**
- `open(path)` — validates git repo, creates record, starts GitWatcher for main worktree
- `close(id)` — stops watcher, optionally cleans orphaned worktrees
- `list()`, `get(id)` — CRUD
- Repository branch is always read live from git

**SessionService**
- `create(repositoryId, { name, sourceBranch, targetBranch, useWorktree })` — creates record, optionally creates git worktree via GitService
- `send(sessionId, message, options?)` — spawns or reuses Claude SDK process, streams response via EventBus
- `interrupt(sessionId)` — stops current query, keeps process alive
- `stop(sessionId)` — kills SDK process, session goes idle
- `resume(sessionId)` — reconnects to existing claudeSessionId
- `destroy(sessionId)` — kills process, optionally removes worktree, deletes record
- Subscribes to EventBus for git changes on paths matching its active sessions

**GitService**
- `getBranch(path)`, `getStatus(path)` — current state
- `createWorktree(repoPath, branch, path)`, `removeWorktree(repoPath, path)`, `listWorktrees(repoPath)`
- `checkout(path, branch)`, `createBranch(path, name, from?)`
- `merge(path, source, target)`, `rebase(path, branch, onto)`
- `listBranches(path)`, `branchStatus(path)` — ahead/behind remote
- All operations are path-scoped — work on any worktree, not just main

### Infrastructure

**ProcessManager**
- Spawns one child process per active session (running `session-bridge.ts`)
- Manages process lifecycle: spawn, send commands (stdin), receive events (stdout), kill
- Processes stay alive between queries — avoids re-initialization overhead
- Killed on explicit `stop()` or after inactivity timeout (default: 30 minutes)

**Why child processes instead of in-process SDK calls?** The Claude Agent SDK can be called in-process via its async generator API (`query()`). The SDK itself spawns a Claude Code subprocess internally, so some crash isolation is already provided. However, we use a bridge child process for:
- **Stable communication protocol** — the SDK's `query()` returns an in-process async generator, not a controllable subprocess. A bridge process provides a clean stdin/stdout JSON-lines protocol that the ProcessManager can manage uniformly
- **State encapsulation** — each bridge process owns its own `MessageStream`, pending approval promises, and SDK session state. No shared mutable state between sessions in the Fastify process
- **Clean kill semantics** — `process.kill()` is deterministic; cancelling in-process async generators and cleaning up SDK state is not
- **Tradeoff**: adds one extra process layer (Fastify → bridge → Claude Code). The bridge is a thin relay — stdin/stdout serialization overhead is negligible for a tool managing <20 concurrent sessions

**EventBus**
- Internal pub/sub with path-based topics
- GitWatcher emits events by filesystem path (no domain knowledge)
- Services subscribe to paths they care about and correlate to their domain entities
- WebSocket handler subscribes and enriches events with repositoryId/sessionId before forwarding to frontend

**GitWatcher**
- Per-repository filesystem watcher (chokidar)
- Watches `.git/HEAD` and `.git/refs/` in main worktree and all session worktrees
- On change: reads current branch, compares to previous, emits `git:branch-changed` on EventBus
- Polling fallback for operations that don't trigger fs events (rebases, etc.)
- Has zero knowledge of sessions or repositories — purely path-based

**Store (SQLite)**
- `repositories` table: id, path, name, createdAt, lastOpenedAt
- `sessions` table: all session fields from domain model
- No message storage — messages are in-memory during session and in SDK's own history (`~/.claude/sessions/`)

### Session Bridge (`session-bridge.ts`)

A TypeScript script that runs as a child process, bridging stdin/stdout to the Claude Agent SDK.

**stdin commands (JSON lines):**
- `start` — begin new query or enqueue message to existing MessageStream
- `reply` — answer tool approval / user question (keyed by `toolUseID` from SDK)
- `interrupt` — abort current query, keep process alive
- `stop` — clean shutdown
- `loadHistory` — load prior session messages via `getSessionMessages()` SDK API

**stdout events (JSON lines):**
- Raw SDK `SDKMessage` events forwarded unmodified. The SDK emits a union of message types including: `assistant` (with content blocks: text, tool_use, tool_result), `user`, `result`, `system`, `stream_event` (partial/streaming), `status`, `hook_started`, `hook_progress`, `hook_response`, `tool_progress`, `task_notification`, `task_started`, `task_progress`, `rate_limit`, `prompt_suggestion`, and others
- Tool use and tool results appear as **content blocks within `assistant` messages** (standard Anthropic API format), not as separate top-level event types
- Bridge does not filter, transform, or interpret SDK-originated events
- Bridge may add its own events: `{ type: "bridge:ready" }`, `{ type: "bridge:error" }`, `{ type: "bridge:history", messages: [...] }`

**Tool approval flow:**
The SDK's `canUseTool` callback is async — it returns `Promise<PermissionResult>` and the agent loop awaits it. The callback receives `(toolName, input, options)` where `options` includes `toolUseID`, `signal`, `suggestions`, `decisionReason`, and `agentID`. The bridge handles this with a deferred promise pattern:
1. SDK calls `canUseTool(toolName, toolInput, { toolUseID, ... })` — bridge uses the SDK-provided `toolUseID` as the correlation key
2. Bridge emits `{ type: "tool_confirmation", toolUseID, toolName, toolInput, agentID?, decisionReason?, suggestions? }` to stdout
3. Bridge creates a deferred Promise keyed by `toolUseID` and returns it to the SDK
4. Parent (ProcessManager) forwards the event to the frontend via EventBus/WebSocket
5. User clicks Allow/Deny → frontend sends `{ command: "session:reply", toolUseID, decision }` back
6. ProcessManager sends `{ cmd: "reply", toolUseID, decision }` to bridge stdin
7. Bridge resolves the deferred Promise with `{ behavior: "allow" | "deny" }` → SDK proceeds or skips

**Message history:**
The SDK exports `getSessionMessages(sessionId)` which returns `Promise<SDKMessage[]>` — the same message types emitted during live streaming. The SDK also exports `listSessions({ cwd })` for discovering past sessions filtered by project path. The bridge exposes both:
- `loadHistory` command: calls `getSessionMessages(sessionId)`, emits `{ type: "bridge:history", messages }` on stdout. The frontend renders history using the same message component registry as live messages — no separate rendering path needed.
- `listSessions` command: calls `listSessions({ cwd })`, returns session metadata (sessionId, cwd, lastModified, gitBranch).
- During a live session, messages are also accumulated in-memory by the frontend (received via WebSocket events) for immediate scroll-back without re-fetching.

**Persistent message stream (bridge internal):**
The bridge internally implements a `MessageStream` — an `AsyncIterable<SDKUserMessage>` that is passed as the `prompt` parameter to the SDK's `query()`. This is a bridge abstraction, not an SDK type. When the user sends a new message, the bridge enqueues it into the `MessageStream`, and the SDK's running `query()` loop consumes it. This is how multi-turn conversation works without restarting the query.

**V2 SDK interface:**
The SDK also exposes `unstable_v2_createSession()` and `unstable_v2_resumeSession()` functions that return session objects with `.send()` / `.stream()` methods. This maps closely to our session lifecycle. While marked as unstable, it simplifies multi-turn management. The bridge should start with the V1 `query()` + `AsyncIterable<SDKUserMessage>` approach and migrate to V2 when it stabilizes.

**Settings passthrough:**
- Process spawned with `cwd` set to session's worktree path (or repository path)
- Bridge must explicitly pass `settingSources: ['user', 'project', 'local']` when creating the SDK session — without this, the SDK does **not** load filesystem settings by default
- Environment variables include user's Claude API keys from `~/.claude/settings.json`
- With `settingSources` configured, the SDK loads CLAUDE.md, `.claude/settings.json`, MCP servers, and plugins from both user home and project directory

### Session Lifecycle

```
create() → IDLE (no process)
    │
    send(message) → STARTING (spawning child process)
    │
    SDK init event → ACTIVE (query running, streaming)
    │                  ↑
    │            send() enqueues into MessageStream
    │
    result event → IDLE (process alive, waiting)
    │
    stop() or timeout → STOPPED (process killed, record preserved for resume)
    │
    resume() → STARTING (spawns new process, reconnects via claudeSessionId)

  ERROR (process crashed) ──resume()──→ STARTING
  STOPPED ──resume()──→ STARTING
  any state ──destroy()──→ (record deleted)
```

Process stays alive between queries to avoid re-initialization overhead. Only killed on explicit stop or inactivity timeout. `resume()` is valid from `STOPPED` and `ERROR` states — it spawns a fresh process and reconnects to the existing SDK session.

### Git State Change Flow

```
GitWatcher detects .git/HEAD change at path X
    │
    ▼
EventBus emit: { event: "repository:git-changed", path: X, from: "feat/auth", to: "dev" }
    │
    ├──▶ SessionService (subscribed to paths of its sessions)
    │       │
    │       ├── If session is active: interrupt query, inject system message
    │       │   informing the agent of the branch change
    │       │
    │       └── If session is idle: flag mismatch, prepend system message
    │           to next user message
    │
    ├──▶ RepositoryService (subscribed to main worktree path)
    │       └── Update repository state, notify sessions with matching targetBranch
    │
    └──▶ WebSocket handler → enriches with sessionId/repositoryId → frontend
```

## API Surface

### REST Endpoints

**Repositories**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/repositories` | List all repositories |
| `POST` | `/repositories` | Open repo as repository `{ path, name? }` |
| `GET` | `/repositories/:id` | Get repository (includes live git branch) |
| `DELETE` | `/repositories/:id` | Close repository |

**Sessions**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/repositories/:id/sessions` | List sessions for repository |
| `POST` | `/repositories/:id/sessions` | Create session `{ name, sourceBranch, targetBranch, useWorktree }` |
| `GET` | `/sessions/:id` | Get session |
| `PATCH` | `/sessions/:id` | Update metadata (name, targetBranch) |
| `DELETE` | `/sessions/:id` | Destroy session |
| `POST` | `/sessions/:id/send` | Send message `{ message, model?, effort?, permissionMode? }` |
| `POST` | `/sessions/:id/reply` | Reply to tool approval `{ toolUseID, decision }` |
| `POST` | `/sessions/:id/interrupt` | Interrupt current query |
| `POST` | `/sessions/:id/stop` | Stop session process |
| `POST` | `/sessions/:id/resume` | Resume session |
| `GET` | `/sessions/:id/history` | Load message history via SDK's `getSessionMessages()` — returns `SDKMessage[]` |
| `GET` | `/repositories/:id/claude-sessions` | List SDK sessions for this repository path via `listSessions({ cwd })` — useful for importing/resuming prior Claude sessions |

**Git**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/repositories/:id/git/status` | Status of main worktree |
| `GET` | `/repositories/:id/git/branches` | List branches + ahead/behind |
| `GET` | `/repositories/:id/git/worktrees` | List all worktrees |
| `POST` | `/repositories/:id/git/checkout` | Checkout branch `{ branch, path? }` |
| `POST` | `/repositories/:id/git/branch` | Create branch `{ name, from? }` |
| `POST` | `/repositories/:id/git/merge` | Merge `{ source, target }` |
| `POST` | `/repositories/:id/git/rebase` | Rebase `{ branch, onto }` |

### WebSocket Protocol

Single multiplexed connection at `/ws`. Events carry `sessionId` or `repositoryId` for routing.

**Server → Client:**

```jsonc
// SDK passthrough (raw, unmodified)
{ "event": "session:message", "sessionId": "...", "data": { /* raw SDK event */ } }

// Session state change
{ "event": "session:state", "sessionId": "...", "data": { "from": "idle", "to": "active" } }

// Query completed with metrics
{ "event": "session:result", "sessionId": "...", "data": { "costUsd": 0.03, "inputTokens": 1200, "outputTokens": 800 } }

// Tool approval needed (toolUseID comes from SDK's canUseTool callback)
{ "event": "session:tool-confirmation", "sessionId": "...", "data": { "toolUseID": "...", "toolName": "Edit", "toolInput": {}, "agentID": "...", "decisionReason": "..." } }

// Git state change (enriched with domain context)
{ "event": "repository:git-changed", "repositoryId": "...", "sessionId": "...", "data": { "path": "...", "from": "feat/auth", "to": "dev", "expected": "feat/auth" } }
```

**Client → Server:**

```jsonc
{ "command": "session:send", "sessionId": "...", "data": { "message": "...", "model": "sonnet" } }
{ "command": "session:reply", "sessionId": "...", "data": { "toolUseID": "...", "decision": "allow" } }
{ "command": "session:interrupt", "sessionId": "..." }
```

### REST Response Conventions

- All `GET` and `POST` (create) endpoints return the full domain object as JSON
- `PATCH` returns the updated object
- `DELETE` returns `204 No Content`
- `POST /sessions/:id/send` returns `202 Accepted` with `{ sessionId }` — actual responses flow via WebSocket
- `POST /sessions/:id/reply` returns `200 OK` with `{ sessionId }` — resolves the pending tool approval, query continues streaming via WebSocket
- `POST /sessions/:id/interrupt` and `POST /sessions/:id/stop` return `200 OK` with `{ sessionId, state }`
- Error responses follow the format `{ error: string, code: string, details?: any }` with appropriate HTTP status codes (400 for validation, 404 for not found, 409 for conflicts like duplicate main-worktree sessions, 500 for internal errors)

## Error Handling

### SDK Process Crashes
- ProcessManager detects child process exit via `close` event
- Session state transitions to `error` with the exit code/signal stored
- Frontend receives `session:state` event with `{ from: "active", to: "error", reason: "process_crashed" }`
- User can `resume()` to restart the session (spawns new process, reconnects via claudeSessionId)
- No auto-restart — the user decides when to retry

### Git Operation Failures
- GitService operations (merge, rebase, checkout) may fail due to conflicts, locked worktrees, etc.
- Failures return HTTP error responses with the git error message in `details`
- Merge conflicts are not auto-resolved — the error response includes the conflicting files so the frontend can display them. The user can ask the agent in a session to resolve conflicts.

### WebSocket Disconnection
- Frontend auto-reconnects with exponential backoff (1s, 2s, 4s, max 30s)
- On reconnect, frontend fetches current state via REST (`GET /repositories`, `GET /sessions`) to reconcile any missed events
- Messages sent during an active query that were missed are not replayed — the frontend re-subscribes and picks up from the current point. In-memory message history may have gaps; this is acceptable for iteration 1.

### Validation
- `POST /repositories` validates: path exists, is a directory, contains `.git/`
- `POST /sessions` validates: repository exists, sourceBranch and targetBranch are non-empty
- `POST /sessions/:id/send` validates: session exists, session is not in `completed` or `error` state

## Frontend Architecture

### Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Framework | Nuxt 4 (SSR disabled) | User requirement, SPA mode |
| UI | NuxtUI v4 + Tailwind | User requirement; no custom CSS, no handmade primitives |
| State | Pinia | Standard for Vue/Nuxt |
| NuxtUI chat | `UChatMessage`, `UChatMessages`, `UChatPrompt`, `UChatPromptSubmit`, `UChatReasoning`, `UChatTool`, `UChatShimmer` | Built-in chat components — render messages, prompt input, thinking, tool invocations |
| NuxtUI dashboard | `UDashboardGroup`, `UDashboardPanel`, `UDashboardSidebar`, `UDashboardResizeHandle`, `UDashboardNavbar`, `UDashboardToolbar` | Layout primitives — resizable panels, sidebar, navigation |
| NuxtUI general | `UTabs`, `UModal`, `UButton`, `USelect`, `UBadge`, `UAlert`, `UCollapsible`, `UDropdownMenu`, `UTooltip` | Standard UI components |

### Layout

```
RepositoryTabBar        — top-level repo tabs (like VSCode window tabs)
└── RepositoryView      — container for one repository
    └── SessionTabBar   — session tabs within repository (like VSCode editor tabs)
        └── SessionView — container: header + chat + prompt
            ├── SessionHeader    — branch info (source → target), state, metrics
            ├── ChatHistory      — scrollable message list
            │   ├── UserMessage
            │   ├── AssistantMessage
            │   ├── ToolInvocation       (collapsible)
            │   ├── ToolApprovalBar      [Allow/Deny]
            │   ├── SubagentBlock        (expandable)
            │   ├── ThinkingBlock        (collapsible)
            │   ├── SystemMessage        (git warnings, etc.)
            │   └── ErrorNotice
            └── PromptBox
                ├── Input area + send button
                └── PromptToolbar (model, effort, permission selectors)
```

### Component Design

Each SDK message type and content block type gets a dedicated Vue component. This enables isolated improvements — redesign tool invocation rendering without touching assistant text, improve the prompt box without touching chat history.

The SDK emits messages at two levels:
1. **Top-level message types**: `assistant`, `user`, `result`, `system`, `stream_event`, `rate_limit`, `task_notification`, etc.
2. **Content blocks within assistant messages**: `text`, `tool_use`, `tool_result` (standard Anthropic API format)

The frontend needs registries for both levels:

**Message type registry** (top-level SDK messages):

```typescript
const messageComponents: Record<string, Component> = {
  'assistant': AssistantMessage,      // renders content blocks (text, tool_use, tool_result)
  'user': UserMessage,
  'system': SystemMessage,
  'result': SessionMetrics,
  'rate_limit': RateLimitNotice,
  'task_notification': TaskDisplay,
  // New SDK types: add one component + one line here
  // Unknown types: GenericMessage fallback renders raw JSON
}
```

**Content block registry** (within assistant messages):

```typescript
const contentBlockComponents: Record<string, Component> = {
  'text': TextBlock,
  'tool_use': ToolInvocation,
  'tool_result': ToolResult,
  'thinking': ThinkingBlock,
  // Unknown blocks: GenericBlock fallback
}
```

Tool approval (`session:tool-confirmation`) is not an SDK message type — it's an event generated by the bridge from the `canUseTool` callback. It is handled by `ToolApprovalBar`, rendered outside the message list (as an action bar).

### State Management (Pinia)

**`useRepositoryStore`** — repository CRUD, active repository tracking
**`useSessionStore`** — session CRUD, in-memory message history (Map<sessionId, ChatMessage[]>), active session per repository
**`useGitStore`** (iteration 2) — branch/worktree state, git actions

### WebSocket Client

Composable `useWebSocket()`:
- Connects on app mount, auto-reconnects
- Parses events, dispatches to correct store based on event type
- Exposes `send(command)` for session interactions
- Provides connection status for UI indicators

### PromptBox Behavior

- `Enter` to send, `Shift+Enter` for newline, `Esc` to interrupt
- Model/effort selectors with last-used memory per repository
- State-aware: disabled during tool approval, shows "Interrupt" during active query

## Project Structure

```
oncraft/
├── packages/
│   ├── backend/
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   ├── services/
│   │   │   │   ├── repository.service.ts
│   │   │   │   ├── session.service.ts
│   │   │   │   └── git.service.ts
│   │   │   ├── routes/
│   │   │   │   ├── repository.routes.ts
│   │   │   │   ├── session.routes.ts
│   │   │   │   ├── git.routes.ts
│   │   │   │   └── ws.routes.ts
│   │   │   ├── infra/
│   │   │   │   ├── process-manager.ts
│   │   │   │   ├── event-bus.ts
│   │   │   │   ├── git-watcher.ts
│   │   │   │   └── store.ts
│   │   │   ├── bridge/
│   │   │   │   └── session-bridge.ts
│   │   │   └── types/
│   │   │       └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── frontend/
│       ├── app/
│       │   ├── components/
│       │   │   ├── repository/
│       │   │   ├── session/
│       │   │   ├── chat/
│       │   │   ├── prompt/
│       │   │   └── git/
│       │   ├── composables/
│       │   ├── stores/
│       │   └── types/
│       ├── app.vue
│       ├── nuxt.config.ts
│       └── package.json
├── pnpm-workspace.yaml
├── package.json
├── Taskfile.yml
└── AGENTS.md
```

## Deployment Modes

The architecture supports multiple deployment scenarios without structural changes:

| Mode | Description |
|------|-------------|
| **Local development** | Backend + frontend on localhost (default) |
| **Remote / SaaS** | Backend on a server, frontend SPA served statically; requires adding auth layer |
| **Tauri desktop** | Frontend as Tauri webview, backend as sidecar process |

## Iteration Roadmap

| Iteration | Scope |
|-----------|-------|
| **1** | Backend: SessionService + GitService + ProcessManager + session-bridge. Frontend: repository tabs, session tabs, chat rendering, prompt box. Full Claude Code session lifecycle with git context. |
| **2** | Git UI panel: branch visualization, worktree management, checkout/merge/rebase from UI. GitWatcher state change notifications. |
| **3** | Overall layout refinement (UDashboardGroup, UPane), multi-session UX polish, session metadata management. |
| **4** | Workflow layer: kanban board, session state transitions, triggers, flow configuration. |

## Explicitly Deferred

| Feature | Rationale |
|---------|-----------|
| Workflow/kanban | Iteration 4 |
| Settings management UI | Start with filesystem passthrough; add UI later |
| Session forking | After basic sessions are solid |
| MCP tools exposed to Claude | When workflows land |
| Console mode (raw PTY/xterm) | Nice-to-have, low priority |
| Auth / multi-user | Not planned (local tool first) |
