# OnCraft Remake — Product Requirements Document

**Last updated:** 2026-03-29
**Status:** Living document

---

## 1. Problem

Developers using Claude Code for agentic work across multiple git repositories face three compounding problems:

1. **No session-to-git-state binding.** Existing tools (including the original OnCraft) don't declare which branch a session works on, which branch it targets, or which worktree it operates in. Agents silently drift onto wrong branches, collide with each other, and produce commits in unexpected places.

2. **No parallel session orchestration.** Running multiple Claude Code sessions means multiple terminals, manual tracking of which agent is doing what, and no central view of cost, state, or progress.

3. **No coordination across repositories.** When a project spans multiple repos (e.g., a backend and a frontend), there is no mechanism to express "when backend lands, trigger frontend integration tests" — that coordination lives entirely in the developer's head.

---

## 2. Product Vision

**OnCraft Remake is a web-based orchestration dashboard for parallel Claude Code sessions with first-class git context.**

Every session explicitly declares its source branch, target branch, and optional worktree. The system actively observes git state and surfaces mismatches. The developer sees all their sessions in one place — across repos — with real-time streaming of agent output, cost tracking, and tool approval flows.

The long-term vision extends to an event-driven workflow engine where session state transitions trigger automated actions across the session, repository, and project hierarchy.

### Product Principles

| Principle | Implication |
|-----------|-------------|
| **Backend is the product** | The Fastify API is the durable interface. The Nuxt frontend is a replaceable consumer. Third-party tools, CLI scripts, and MCP clients can use the same API. |
| **SDK passthrough** | Claude Agent SDK events flow to the frontend unmodified. The backend may inject context *to the agent* (e.g., "branch changed") but never transforms what the frontend receives. No feature loss from SDK updates. |
| **Observe, don't assume** | Git state is read from the filesystem, not inferred from what the tool last did. A developer checking out a branch manually is detected the same way an agent checkout is. |
| **Parallel by default** | Multiple sessions can be active simultaneously. The system detects worktree conflicts but lets the user decide how to resolve them. |

---

## 3. Target Users

### Primary: Solo developers using Claude Code for multi-repo work

- Run 2-5 Claude Code sessions in parallel across 1-3 repositories
- Need branch isolation (worktrees) to prevent agent collisions
- Want a single dashboard instead of multiple terminal windows
- Care about cost tracking and being able to interrupt/resume sessions

### Secondary: Small teams sharing an OnCraft instance

- Not in initial scope (no auth/multi-user)
- Architecture should not preclude this (stateless frontend, API-first backend)

### Non-target: Enterprise / managed service

- OnCraft is a local-first developer tool, not a SaaS platform
- No multi-tenancy, billing, or admin features planned

---

## 4. Domain Model

```
Project (1 per OnCraft instance)
  └─ Repository* (enriched git repo + orchestration state)
       └─ Session* (AI agent + branch context + lifecycle)
```

| Entity | Definition |
|--------|-----------|
| **Project** | Named coordination context grouping repositories. One per instance. Owns default workflow config and cross-repo hooks (future). |
| **Repository** | OnCraft's enriched representation of a git repo. Wraps a path with orchestration: sessions, workflow overrides, state. The raw git repo is an implementation detail. |
| **Session** | A Claude Code conversation bound to a repository, optionally isolated in a worktree, with explicit source/target branches and a lifecycle state machine. |

Each level is designed to support an AI assistant in the future (project-level coordinator, repo-level coordinator, session-level agent).

---

## 5. Functional Requirements

### 5.1 Repository Management

| ID | Requirement | Priority |
|----|-------------|----------|
| R1 | Add a git repository by path, with optional display name | P0 |
| R2 | List all repositories with their current git branch (read live) | P0 |
| R3 | Remove a repository (stops sessions, cleans up) | P0 |
| R4 | Detect and reject invalid paths (not a git repo) | P0 |

### 5.2 Session Lifecycle

| ID | Requirement | Priority |
|----|-------------|----------|
| S1 | Create a session with name, source branch, target branch | P0 |
| S2 | Optionally create a dedicated worktree for session isolation | P0 |
| S3 | Send messages to session, streaming response in real-time | P0 |
| S4 | Approve or deny tool use requests from the agent | P0 |
| S5 | Interrupt an active query without killing the process | P0 |
| S6 | Stop a session (kill process, preserve state for resume) | P0 |
| S7 | Resume a stopped session using SDK session ID | P0 |
| S8 | Load message history from SDK for existing sessions | P1 |
| S9 | Track and display cost (USD), input/output tokens per session | P0 |
| S10 | Detect worktree conflicts (two active sessions on same worktree) | P1 |
| S11 | Session state machine: idle / starting / active / stopped / error / completed | P0 |

### 5.3 Git Context

| ID | Requirement | Priority |
|----|-------------|----------|
| G1 | Display source branch and target branch per session | P0 |
| G2 | Watch filesystem for git state changes (branch switches, new commits) | P0 |
| G3 | Detect branch mismatches (actual branch != session's source branch) | P1 |
| G4 | Inject system message to agent when branch changes under it | P1 |
| G5 | List branches with ahead/behind remote status | P1 |
| G6 | Create, checkout, merge, rebase branches from UI | P2 |
| G7 | Manage worktrees from UI | P2 |

### 5.4 Real-Time Communication

| ID | Requirement | Priority |
|----|-------------|----------|
| W1 | Single multiplexed WebSocket for all session events | P0 |
| W2 | Auto-reconnect with exponential backoff | P0 |
| W3 | Reconcile state via REST after reconnect | P1 |
| W4 | Stream all SDK message types to frontend unmodified | P0 |

### 5.5 Frontend

| ID | Requirement | Priority |
|----|-------------|----------|
| F1 | Repository tab bar (switch between repos) | P0 |
| F2 | Session tab bar within each repository | P0 |
| F3 | Chat view with message history, prompt input, model/effort selectors | P0 |
| F4 | Render SDK message types: text, tool use, tool result, thinking, system | P0 |
| F5 | Tool approval bar (Allow/Deny) | P0 |
| F6 | Session header: branch info, state badge, cost/token display | P0 |
| F7 | Unknown SDK message type: generic JSON fallback | P0 |
| F8 | Git panel: branch visualization, worktree list, git actions | P2 |
| F9 | Dashboard layout with resizable panels | P2 |

### 5.6 Project (Minimal)

| ID | Requirement | Priority |
|----|-------------|----------|
| P1 | Get/update project name and settings | P1 |
| P2 | Cross-repo event coordination | P3 |
| P3 | Project-level AI assistant | P3 |

---

## 6. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NF1 | Backend must handle 20 concurrent sessions without degradation |
| NF2 | Sub-100ms latency for REST CRUD operations |
| NF3 | WebSocket event latency < 50ms from bridge stdout to frontend |
| NF4 | SQLite database — no external database dependencies |
| NF5 | Single `bun` binary for backend (future compilation target) |
| NF6 | Frontend works as static SPA — no SSR dependency |
| NF7 | No authentication in iteration 1 (local tool) |

---

## 7. Deployment Modes

| Mode | Description | Status |
|------|-------------|--------|
| **Local development** | Backend + frontend on localhost | Current |
| **Remote / SaaS** | Backend on server, SPA served statically (+ auth layer) | Planned |
| **Tauri desktop** | Frontend as Tauri webview, backend as sidecar | Planned |

---

## 8. Iteration Roadmap

| Iteration | Focus | Key Deliverables |
|-----------|-------|-----------------|
| **1** | Core session lifecycle | Repository/session CRUD, session bridge, chat UI, WebSocket streaming, git context, cost tracking |
| **2** | Git UI | Branch visualization, worktree management, checkout/merge/rebase from UI, git state change notifications |
| **3** | Layout & UX | Dashboard panels (UDashboardGroup), multi-session UX polish, session metadata management |
| **4** | Workflow engine | Kanban board, session state machines, hooks, triggers, cross-repo coordination |

---

## 9. Explicitly Deferred

| Feature | Rationale |
|---------|-----------|
| Workflow / kanban | Iteration 4 — needs stable session lifecycle first |
| Settings management UI | Start with filesystem passthrough (`settingSources`) |
| Session forking | After basic sessions are solid |
| MCP server (OnCraft as MCP) | When workflows land — expose project/repo/session management to external agents |
| Console mode (raw PTY) | Low priority nice-to-have |
| Auth / multi-user | Not planned (local-first tool) |
| Message persistence | SDK owns history (`~/.claude/sessions/`); OnCraft doesn't duplicate it |

---

## 10. Success Criteria

For Iteration 1, the product is successful when:

1. A developer can add a repository, create 2+ sessions on different branches (with worktrees), send messages, and see streaming responses — all from a single browser tab.
2. Tool approval flows work end-to-end (agent requests tool → user sees approval bar → user approves → agent proceeds).
3. Git state changes are detected and surfaced (branch mismatch warning when an agent or user switches branches).
4. Session cost and token usage are visible and accurate.
5. Stopping and resuming a session works (process killed, re-spawned, SDK session reconnected).

---

## 11. Open Questions

| Question | Context |
|----------|---------|
| Should OnCraft expose itself as an MCP server? | Would let external Claude Code sessions manage OnCraft programmatically. Deferred to post-workflow. |
| V2 SDK migration timing | The SDK has `unstable_v2_createSession()` / `unstable_v2_resumeSession()` that simplify multi-turn. Bridge currently uses V1 `query()` + AsyncIterable. Migrate when V2 stabilizes. |
| Inactivity timeout policy | ProcessManager should kill idle bridge processes after N minutes. Default 30min — needs UX for configuration. |
| Session templates | Pre-configured session setups (branch naming, model, effort, system prompt). Nice-to-have for iteration 2-3. |
