# Terminology Rename: Project > Repository > Session

**Date:** 2026-03-28
**Status:** Draft
**Scope:** Rename domain model terminology across the full stack

---

## Problem Statement

OnCraft Remake currently uses "workspace" to represent a git repository with its state. This naming is wrong for the product vision:

1. **No concept of "set of repositories"** — OnCraft needs a top-level coordination layer grouping multiple repos. "Workspace" is the natural fit for that, but it's already taken by the repo-level entity.
2. **MCP exposure** — AI agents will manage projects, repositories, and sessions via MCP. The terminology must be immediately clear to both humans and agents.
3. **AI assistants at every level** — each level (project, repository, session) can have an AI assistant. The names must reflect the scope of what each level coordinates.

Renaming now (small codebase, no external consumers) is far cheaper than renaming later.

---

## Domain Model

### Hierarchy

```
Project (1 per OnCraft instance)
  └─ Repository* (git repo + orchestration state)
       └─ Session* (workstream: AI agent + lifecycle + branch context)
```

### Definitions

| Term | Definition | Persistence | AI-capable |
|------|-----------|-------------|------------|
| **Project** | A named coordination context grouping repositories. One per OnCraft instance. Implicit in UI (chosen at launch), explicit in backend and MCP. Owns default workflow definition and cross-repository hooks. | SQLite + config | Yes — project-level assistant coordinates across repos |
| **Repository** | OnCraft's enriched representation of a git repo. Wraps a git repository path with orchestration: sessions, workflow overrides, repo-level hooks, and state. The raw git repo (branches, worktrees, commits) is an implementation detail accessed through the repository. | SQLite (was `workspaces` table) | Yes — repo-level assistant coordinates sessions |
| **Session** | A workstream: a Claude Code conversation bound to a repository, optionally isolated in a git worktree, progressing through workflow lifecycle states. Produces commits, responds to state transition events. | SQLite + SDK history | Yes — the primary AI agent doing work |

### What is NOT a domain entity

| Concept | Role |
|---------|------|
| Git repository (raw) | Implementation detail of `Repository`. Accessed via `/repositories/:id/git/...` |
| Worktree | Implementation detail of `Session`. A session *may* use a dedicated worktree. |
| Workflow | Configuration of `Project` (default) or `Repository` (override). Not a standalone entity. |
| Hook | Configuration attached to project, repository, or session level. Not a standalone entity. |

---

## Naming Conventions

| Context | Convention | Example |
|---------|-----------|---------|
| TypeScript types/interfaces | PascalCase full name | `interface Repository { ... }` |
| Local variables | camelCase, `repo` shorthand OK | `const repo = await repoService.get(id)` |
| IDs in types | Full name | `session.repositoryId` |
| Service classes | Full name + Service | `RepositoryService` |
| Pinia stores | `use` + full name + `Store` | `useRepositoryStore` |
| API paths | Plural for collections, singular for project | `/repositories/:id`, `/project` |
| SQLite tables | Plural for collections, singular for project | `repositories`, `project`, `sessions` |
| Event topics | Entity + colon + event | `session:state-changed`, `repository:git-changed` |
| MCP tools | Entity + colon + action | `repository:list`, `session:create` |

---

## REST API Surface

### Project (singular — one per instance)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/project` | Get project info |
| `PATCH` | `/project` | Update project settings |

### Repositories

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/repositories` | Add repository `{ path, name? }` |
| `GET` | `/repositories` | List all repositories |
| `GET` | `/repositories/:id` | Get single repository (includes live branch) |
| `PATCH` | `/repositories/:id` | Update repository settings |
| `DELETE` | `/repositories/:id` | Remove repository from project |

### Sessions

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/repositories/:repositoryId/sessions` | Create session |
| `GET` | `/repositories/:repositoryId/sessions` | List sessions for repository |
| `GET` | `/sessions/:id` | Get single session |
| `PATCH` | `/sessions/:id` | Update session metadata |
| `DELETE` | `/sessions/:id` | Destroy session |
| `POST` | `/sessions/:id/send` | Send message to agent |
| `POST` | `/sessions/:id/reply` | Reply to tool approval |
| `POST` | `/sessions/:id/interrupt` | Interrupt current query |
| `POST` | `/sessions/:id/stop` | Stop session process |
| `POST` | `/sessions/:id/resume` | Resume stopped session |
| `GET` | `/sessions/:id/history` | Load message history |
| `POST` | `/sessions/:id/advance` | Advance to next workflow state (new) |

### Git Operations (namespaced under repository)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/repositories/:id/git/status` | Git status |
| `GET` | `/repositories/:id/git/branches` | List branches |
| `GET` | `/repositories/:id/git/worktrees` | List worktrees |
| `POST` | `/repositories/:id/git/checkout` | Checkout branch |
| `POST` | `/repositories/:id/git/branch` | Create branch |
| `POST` | `/repositories/:id/git/merge` | Merge |
| `POST` | `/repositories/:id/git/rebase` | Rebase |

---

## WebSocket Events

### Server → Client

| Event | Payload | Scope |
|-------|---------|-------|
| `session:message` | `{ sessionId, raw }` | Session |
| `session:state-changed` | `{ sessionId, repositoryId, from, to }` | Session |
| `session:result` | `{ sessionId, costUsd, inputTokens, outputTokens }` | Session |
| `session:process-exit` | `{ sessionId, code }` | Session |
| `session:worktree-conflict` | `{ sessionId, conflictsWith }` | Session |
| `session:branch-mismatch` | `{ sessionId, expected, actual }` | Session |
| `repository:git-changed` | `{ repositoryId, branch }` | Repository |
| `error` | `{ message, context? }` | Global |

### Client → Server

| Command | Payload |
|---------|---------|
| `session:send` | `{ sessionId, message, model?, effort? }` |
| `session:reply` | `{ sessionId, toolUseID, decision }` |
| `session:interrupt` | `{ sessionId }` |

---

## Event / Hook Model (future — shapes naming now)

State transitions on sessions emit events that propagate upward through the hierarchy:

```
Session state changes
  → session-level hooks fire (e.g., rebase from source, send prompt to agent)
  → repository-level hooks fire (e.g., session X done → advance session Y)
  → project-level hooks fire (e.g., repo X dev landed → trigger repo Y test session)
```

Event naming pattern:

```
session:state-changed     — a session transitioned workflow state
session:completed         — a session reached terminal state
repository:all-landed     — all sessions in a repo reached "done" (derived)
```

Hook conceptual shape (not implementing now):

```typescript
interface Hook {
  on: string           // event pattern: "session:state-changed"
  when?: object        // condition: { toState: "done", sessionName: "auth" }
  action: string       // "advance-session" | "send-prompt" | "git-op" | ...
  target?: string      // which session/repo to act on
  payload?: object     // action-specific data
}
```

---

## Rename Mapping

### Terminology Changes

| Current | New |
|---------|-----|
| `Workspace` (type) | `Repository` |
| `WorkspaceWithBranch` (type) | `RepositoryWithBranch` |
| `workspaceId` (field) | `repositoryId` |
| `WorkspaceService` | `RepositoryService` |
| `useWorkspaceStore` | `useRepositoryStore` |
| `/workspaces/...` (API) | `/repositories/...` |
| `workspaces` (SQLite table) | `repositories` |
| `git:branch-changed` (event) | `repository:git-changed` |
| `session:state` (event) | `session:state-changed` |

### New Additions

| What | Purpose |
|------|---------|
| `Project` type | Top-level coordination entity |
| `ProjectService` | Get/update project config |
| `project.routes.ts` | `GET /project`, `PATCH /project` |
| `useProjectStore` | Frontend project state |
| `project` SQLite table | Project persistence |
| `POST /sessions/:id/advance` | Workflow state advancement |

### Backend File Changes

| Action | Current path | New path |
|--------|-------------|----------|
| **Rename** | `src/services/workspace.service.ts` | `src/services/repository.service.ts` |
| **Rename** | `src/routes/workspace.routes.ts` | `src/routes/repository.routes.ts` |
| **Create** | — | `src/services/project.service.ts` |
| **Create** | — | `src/routes/project.routes.ts` |
| **Modify** | `src/types/index.ts` | `Workspace` → `Repository`, `workspaceId` → `repositoryId` |
| **Modify** | `src/services/session.service.ts` | All workspace refs → repository |
| **Modify** | `src/routes/session.routes.ts` | Paths and param names |
| **Modify** | `src/routes/git.routes.ts` | Paths and variable names |
| **Modify** | `src/routes/ws.routes.ts` | Event names |
| **Modify** | `src/infra/store.ts` | Table name, column name, method names |
| **Modify** | `src/server.ts` | Route registration |

### Frontend File Changes

| Action | Current path | New path |
|--------|-------------|----------|
| **Rename** | `app/stores/workspace.store.ts` | `app/stores/repository.store.ts` |
| **Create** | — | `app/stores/project.store.ts` |
| **Modify** | `app/types/index.ts` | `Workspace` → `Repository` |
| **Modify** | `app/stores/session.store.ts` | `workspaceId` → `repositoryId` |
| **Modify** | `app/composables/useWebSocket.ts` | Event name updates |
| **Modify** | All Vue components referencing workspaces | Imports, props, variable names |

### Unchanged Files

- `src/bridge/session-bridge.ts` — session-scoped, no workspace references
- `src/services/git.service.ts` — operates on raw paths
- `src/services/process-manager.ts` — keyed by sessionId only
- `src/infra/event-bus.ts` — generic infrastructure
- `app/composables/useMessageRegistry.ts` — message rendering only

### SQLite Migration

```sql
-- Rename workspace table
ALTER TABLE workspaces RENAME TO repositories;

-- Create project table
CREATE TABLE project (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  lastOpenedAt TEXT NOT NULL
);

-- Recreate sessions with renamed column (SQLite limitation)
CREATE TABLE sessions_new (
  id TEXT PRIMARY KEY,
  repositoryId TEXT NOT NULL,
  claudeSessionId TEXT,
  name TEXT NOT NULL,
  sourceBranch TEXT NOT NULL,
  workBranch TEXT,
  targetBranch TEXT,
  worktreePath TEXT,
  state TEXT NOT NULL DEFAULT 'idle',
  createdAt TEXT NOT NULL,
  lastActivityAt TEXT NOT NULL,
  costUsd REAL DEFAULT 0,
  inputTokens INTEGER DEFAULT 0,
  outputTokens INTEGER DEFAULT 0,
  FOREIGN KEY (repositoryId) REFERENCES repositories(id)
);

INSERT INTO sessions_new
  SELECT id, workspaceId, claudeSessionId, name, sourceBranch, workBranch,
         targetBranch, worktreePath, state, createdAt, lastActivityAt,
         costUsd, inputTokens, outputTokens
  FROM sessions;

DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
```

---

## Estimated Scope

| Category | Count |
|----------|-------|
| Files modified | ~20 |
| Files renamed | 3 |
| Files created | 3–4 |
| SQLite migration | 1 |
| Architectural changes | 0 |

---

## Design Decisions

1. **`/project` is singular** — no `/projects/:id`. One per instance.
2. **Git operations namespaced under `/repositories/:id/git/`** — separates OnCraft domain from raw git.
3. **`session:state-changed` replaces `session:state`** — more descriptive, includes `repositoryId` for cross-repo routing.
4. **`repository:git-changed` replaces `git:branch-changed`** — scoped to repository domain.
5. **`/sessions/:id/advance` is new** — explicit trigger for workflow transitions and hook cascades. Distinct from PATCH (metadata updates).
6. **Project is minimal now** — just id/name/timestamps. Will grow with workflow config and hooks.
7. **`repo` shorthand allowed in local variables** — `Repository` in types and API paths, `repo` in code for readability.

---

## Future Vision (context, not scope)

This rename establishes the terminology foundation for:

- **Workflow engine** — session lifecycle states, kanban views, state transitions as events
- **Hook system** — event handlers at session, repository, and project levels
- **MCP server** — AI agents managing projects, repos, and sessions programmatically
- **Cross-repo coordination** — project-level events linking sessions across repositories
- **AI assistants at every level** — project assistant, repository assistant, session agent

None of these are in scope for this rename. They are the reason the terminology must be correct now.
