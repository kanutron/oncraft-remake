# Lifecycle Events & Session Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add notification events to all CRUD operations (session & repository), implement safe session delete with dirty-state checks and `force` bypass, and add session close UI to the frontend.

**Architecture:** Approach A — fire-and-forget notification events on EventBus for all lifecycle operations. Hardcoded safety checks in `SessionService.destroy()` that inspect git status and unmerged commits before worktree removal. The `DELETE /sessions/:id` route accepts `?force=true` to bypass checks. Frontend gets a close button per session tab and a confirmation dialog when delete is blocked.

**Tech Stack:** Bun, Fastify, bun:sqlite, simple-git, Nuxt 4, NuxtUI v4, Pinia

**Spec:** `.context/agents/spec/lifecycle-events/plan.md` (this file)

**Status:** Tasks 1–7 completed. Tasks 8–12 pending (project:updated, session:updated, frontend WS handlers, repo close confirmation, async EventBus).

---

## Event Naming Convention

All lifecycle events follow the pattern `entity:action` emitted on the EventBus with path `*` (global).

| Event | Payload | Emitted by |
|-------|---------|-----------|
| `session:created` | `{ sessionId, repositoryId, name }` | `SessionService.create()` |
| `session:deleted` | `{ sessionId, repositoryId, name }` | `SessionService.destroy()` |
| `repository:opened` | `{ repositoryId, path, name }` | `RepositoryService.open()` |
| `repository:closed` | `{ repositoryId, path, name }` | `RepositoryService.close()` |

These are in addition to existing events (`session:state-changed`, `session:worktree-conflict`, etc.).

---

## File Structure

### Backend Changes

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `packages/backend/src/services/session.service.ts` | Add events to `create()`/`destroy()`, add dirty-state check in `destroy()` |
| Modify | `packages/backend/src/services/repository.service.ts` | Add events to `open()`/`close()`, cascade `destroy()` per session |
| Modify | `packages/backend/src/routes/session.routes.ts` | Accept `?force=true` on DELETE, return 409 on dirty state |
| Modify | `packages/backend/src/routes/ws.routes.ts` | Forward new events to WebSocket clients |
| Modify | `packages/backend/tests/services/session.service.test.ts` | Test events, dirty-state check, force bypass |
| Modify | `packages/backend/tests/routes/session.routes.test.ts` | Test DELETE with force, 409 on dirty |

### Frontend Changes

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `packages/frontend/app/stores/session.store.ts` | Add `destroy()` action, handle `session:deleted` WS event |
| Modify | `packages/frontend/app/components/session/SessionTabBar.vue` | Add close button per tab, confirmation dialog |
| Modify | `packages/frontend/app/composables/useWebSocket.ts` | Handle `session:deleted` event |

---

## Task 1: Add lifecycle events to SessionService

**Files:**
- Modify: `packages/backend/src/services/session.service.ts`
- Modify: `packages/backend/tests/services/session.service.test.ts`

- [x] **Step 1: Write test for `session:created` event**

Add to the existing `describe("SessionService")` block in `packages/backend/tests/services/session.service.test.ts`:

```typescript
test("emits session:created event on create", async () => {
  const events: unknown[] = [];
  eventBus.on("*", "session:created", (data) => events.push(data));

  const session = await service.create("repo-1", {
    name: "test",
    sourceBranch: "feat/x",
    targetBranch: "dev",
  });

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    sessionId: session.id,
    repositoryId: "repo-1",
    name: "test",
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && bun test tests/services/session.service.test.ts`
Expected: FAIL — no `session:created` event emitted

- [x] **Step 3: Write test for `session:deleted` event**

```typescript
test("emits session:deleted event on destroy", async () => {
  const session = await service.create("repo-1", {
    name: "to-delete",
    sourceBranch: "feat/x",
    targetBranch: "dev",
  });

  const events: unknown[] = [];
  eventBus.on("*", "session:deleted", (data) => events.push(data));

  await service.destroy(session.id);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    sessionId: session.id,
    repositoryId: "repo-1",
    name: "to-delete",
  });
});
```

- [x] **Step 4: Implement events in SessionService**

In `packages/backend/src/services/session.service.ts`, add event emission at the end of `create()` (after `this.store.createSession(session)`):

```typescript
this.eventBus.emit("*", "session:created", {
  sessionId: session.id,
  repositoryId,
  name: opts.name,
});
```

In `destroy()`, capture session data before deletion and emit after:

```typescript
async destroy(sessionId: string, opts: { force?: boolean } = {}): Promise<void> {
  const session = this.store.getSession(sessionId);
  if (!session) return;

  if (this.processManager.isAlive(sessionId)) {
    await this.processManager.stop(sessionId);
  }

  if (session.worktreePath) {
    const repo = this.store.getRepository(session.repositoryId);
    if (repo) {
      try {
        await this.gitService.removeWorktree(repo.path, session.worktreePath);
      } catch {
        /* worktree may already be gone */
      }
    }
  }

  this.store.deleteSession(sessionId);

  this.eventBus.emit("*", "session:deleted", {
    sessionId,
    repositoryId: session.repositoryId,
    name: session.name,
  });
}
```

Note: The `opts` parameter is added here but the dirty-state check comes in Task 2. This keeps the diff focused.

- [x] **Step 5: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/session.service.test.ts`
Expected: All tests PASS

- [x] **Step 6: Commit**

```bash
git add packages/backend/src/services/session.service.ts packages/backend/tests/services/session.service.test.ts
git commit -m "feat(backend): emit session:created and session:deleted lifecycle events"
```

---

## Task 2: Add dirty-state check to session destroy

**Files:**
- Modify: `packages/backend/src/services/session.service.ts`
- Modify: `packages/backend/tests/services/session.service.test.ts`

- [x] **Step 1: Write test for dirty worktree blocking destroy**

```typescript
test("destroy throws on dirty worktree unless force is true", async () => {
  const gitService = new GitService();
  await gitService.createBranch(repoPath, "feat/dirty-test");

  const session = await service.create("repo-1", {
    name: "dirty",
    sourceBranch: "feat/dirty-test",
    workBranch: "feat/dirty-test",
    targetBranch: "main",
  });

  // Make the worktree dirty — create an untracked file
  const fs = await import("node:fs");
  fs.writeFileSync(`${session.worktreePath}/dirty.txt`, "uncommitted work");

  // Should throw without force
  try {
    await service.destroy(session.id);
    expect(true).toBe(false); // should not reach
  } catch (err) {
    expect((err as Error).message).toContain("has uncommitted changes");
  }

  // Session should still exist
  expect(service.get(session.id)).not.toBeNull();

  // Should succeed with force
  await service.destroy(session.id, { force: true });
  expect(service.get(session.id)).toBeNull();
});
```

- [x] **Step 2: Write test for unmerged commits blocking destroy**

```typescript
test("destroy throws when work branch has unmerged commits unless force", async () => {
  const gitService = new GitService();
  await gitService.createBranch(repoPath, "feat/unmerged-test");

  const session = await service.create("repo-1", {
    name: "unmerged",
    sourceBranch: "feat/unmerged-test",
    workBranch: "feat/unmerged-test",
    targetBranch: "main",
  });

  // Add a commit to the work branch
  const fs = await import("node:fs");
  const path = await import("node:path");
  fs.writeFileSync(path.join(session.worktreePath!, "new-file.txt"), "content");
  const simpleGit = (await import("simple-git")).default;
  const git = simpleGit(session.worktreePath!);
  await git.add("new-file.txt");
  await git.commit("add new file");

  // Should throw without force
  try {
    await service.destroy(session.id);
    expect(true).toBe(false);
  } catch (err) {
    expect((err as Error).message).toContain("unmerged commits");
  }

  // Should succeed with force
  await service.destroy(session.id, { force: true });
  expect(service.get(session.id)).toBeNull();
});
```

- [x] **Step 3: Write test that sessions without worktrees delete freely**

```typescript
test("destroy succeeds without checks for sessions with no worktree", async () => {
  const session = await service.create("repo-1", {
    name: "no-wt",
    sourceBranch: "feat/x",
    targetBranch: "dev",
  });

  // Should succeed — no worktree means no dirty-state check
  await service.destroy(session.id);
  expect(service.get(session.id)).toBeNull();
});
```

- [x] **Step 4: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/session.service.test.ts`
Expected: The new dirty/unmerged tests FAIL (destroy doesn't check state yet)

- [x] **Step 5: Implement dirty-state check in destroy**

Update `destroy()` in `packages/backend/src/services/session.service.ts`:

```typescript
async destroy(sessionId: string, opts: { force?: boolean } = {}): Promise<void> {
  const session = this.store.getSession(sessionId);
  if (!session) return;

  // Safety check: inspect worktree state before deletion
  if (session.worktreePath && !opts.force) {
    const repo = this.store.getRepository(session.repositoryId);
    if (repo) {
      await this.checkWorktreeSafety(session, repo.path);
    }
  }

  if (this.processManager.isAlive(sessionId)) {
    await this.processManager.stop(sessionId);
  }

  if (session.worktreePath) {
    const repo = this.store.getRepository(session.repositoryId);
    if (repo) {
      try {
        await this.gitService.removeWorktree(repo.path, session.worktreePath);
      } catch {
        /* worktree may already be gone */
      }
    }
  }

  this.store.deleteSession(sessionId);

  this.eventBus.emit("*", "session:deleted", {
    sessionId,
    repositoryId: session.repositoryId,
    name: session.name,
  });
}

private async checkWorktreeSafety(session: Session, repoPath: string): Promise<void> {
  if (!session.worktreePath) return;

  // Check for uncommitted changes
  const status = await this.gitService.getStatus(session.worktreePath);
  if (status.files.length > 0) {
    throw new Error(
      `Session "${session.name}" has uncommitted changes (${status.files.length} files). Use force to delete anyway.`
    );
  }

  // Check for commits on work branch not merged into target
  if (session.workBranch && session.targetBranch) {
    try {
      const simpleGit = (await import("simple-git")).default;
      const git = simpleGit(repoPath);
      const log = await git.log({
        from: session.targetBranch,
        to: session.workBranch,
      });
      if (log.total > 0) {
        throw new Error(
          `Session "${session.name}" has ${log.total} unmerged commits on "${session.workBranch}" (target: "${session.targetBranch}"). Use force to delete anyway.`
        );
      }
    } catch (err) {
      // If the error is ours (unmerged commits), rethrow
      if ((err as Error).message.includes("unmerged commits")) throw err;
      // Otherwise (git error), skip the check — don't block delete on git failures
    }
  }
}
```

Add the import for Session type at the top of the file if not already there:

```typescript
import type { Session, SessionState } from "../types";
```

- [x] **Step 6: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/session.service.test.ts`
Expected: All tests PASS

- [x] **Step 7: Commit**

```bash
git add packages/backend/src/services/session.service.ts packages/backend/tests/services/session.service.test.ts
git commit -m "feat(backend): add dirty-state safety check on session destroy with force bypass"
```

---

## Task 3: Add lifecycle events to RepositoryService and fix cascade delete

**Files:**
- Modify: `packages/backend/src/services/repository.service.ts`
- Modify: `packages/backend/tests/services/repository.service.test.ts`

- [x] **Step 1: Write tests for repository lifecycle events and cascade delete**

Add to `packages/backend/tests/services/repository.service.test.ts`:

```typescript
test("emits repository:opened event on open", async () => {
  const events: unknown[] = [];
  eventBus.on("*", "repository:opened", (data) => events.push(data));

  const repo = await service.open(repoPath);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    repositoryId: repo.id,
    path: repoPath,
    name: repo.name,
  });
});

test("does not emit repository:opened for already-open repo", async () => {
  await service.open(repoPath);
  const events: unknown[] = [];
  eventBus.on("*", "repository:opened", (data) => events.push(data));

  await service.open(repoPath);

  expect(events).toHaveLength(0);
});

test("emits repository:closed event on close", async () => {
  const repo = await service.open(repoPath);
  const events: unknown[] = [];
  eventBus.on("*", "repository:closed", (data) => events.push(data));

  await service.close(repo.id);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    repositoryId: repo.id,
    path: repoPath,
    name: repo.name,
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/repository.service.test.ts`
Expected: FAIL — no events emitted

- [x] **Step 3: Implement events and fix RepositoryService**

`RepositoryService` needs access to `EventBus` and `SessionService` (for cascade destroy). Update the constructor and methods in `packages/backend/src/services/repository.service.ts`:

```typescript
import { basename } from "node:path";
import type { EventBus } from "../infra/event-bus";
import type { GitWatcher } from "../infra/git-watcher";
import type { Store } from "../infra/store";
import type { Repository } from "../types";
import type { GitService } from "./git.service";
import type { SessionService } from "./session.service";

export interface RepositoryWithBranch extends Repository {
  branch: string;
}

export class RepositoryService {
  private sessionService: SessionService | null = null;

  constructor(
    private store: Store,
    private gitService: GitService,
    private gitWatcher: GitWatcher,
    private eventBus: EventBus,
  ) {}

  /** Late-bind to avoid circular dependency (SessionService depends on Store, RepositoryService depends on Store) */
  setSessionService(sessionService: SessionService): void {
    this.sessionService = sessionService;
  }

  async open(path: string, name?: string): Promise<Repository> {
    const isRepo = await this.gitService.isGitRepo(path);
    if (!isRepo) throw new Error(`Not a git repository: ${path}`);

    // Check if already open
    const existing = this.store.listRepositories().find((r) => r.path === path);
    if (existing) {
      this.store.updateRepositoryLastOpened(existing.id, new Date().toISOString());
      return existing;
    }

    const repo: Repository = {
      id: crypto.randomUUID(),
      path,
      name: name ?? basename(path),
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    };

    this.store.createRepository(repo);
    this.gitWatcher.watch(path);

    this.eventBus.emit("*", "repository:opened", {
      repositoryId: repo.id,
      path: repo.path,
      name: repo.name,
    });

    return repo;
  }

  async get(id: string): Promise<RepositoryWithBranch | null> {
    const repo = this.store.getRepository(id);
    if (!repo) return null;
    const branch = await this.gitService.getBranch(repo.path);
    return { ...repo, branch };
  }

  async list(): Promise<Repository[]> {
    return this.store.listRepositories();
  }

  async close(id: string): Promise<void> {
    const repo = this.store.getRepository(id);
    if (!repo) return;

    // Cascade destroy sessions (with force — repo close is intentional)
    if (this.sessionService) {
      const sessions = this.store.listSessions(id);
      for (const session of sessions) {
        await this.sessionService.destroy(session.id, { force: true });
      }
    } else {
      // Fallback: raw delete (no cleanup) — should not happen in production
      this.store.deleteSessionsForRepository(id);
    }

    this.gitWatcher.unwatch(repo.path);
    this.store.deleteRepository(id);

    this.eventBus.emit("*", "repository:closed", {
      repositoryId: id,
      path: repo.path,
      name: repo.name,
    });
  }

  async closeAll(): Promise<void> {
    const repos = this.store.listRepositories();
    for (const repo of repos) {
      await this.close(repo.id);
    }
  }
}
```

- [x] **Step 4: Update server.ts to wire EventBus and SessionService to RepositoryService**

In `packages/backend/src/server.ts`, update the wiring:

```typescript
// Change RepositoryService construction to include eventBus
const repositoryService = new RepositoryService(store, gitService, gitWatcher, eventBus);

// After SessionService is created, set the circular reference
repositoryService.setSessionService(sessionService);
```

- [x] **Step 5: Update build-app.ts test helper with the same wiring**

In `packages/backend/tests/helpers/build-app.ts`, update the same pattern:

```typescript
const repositoryService = new RepositoryService(store, gitService, gitWatcher, eventBus);
// ... sessionService creation stays the same ...
repositoryService.setSessionService(sessionService);
```

- [x] **Step 6: Update repository service tests to provide EventBus**

In `packages/backend/tests/services/repository.service.test.ts`, update the setup to create and pass an EventBus:

```typescript
import { EventBus } from "../../src/infra/event-bus";
// ... in beforeEach:
eventBus = new EventBus();
service = new RepositoryService(store, gitService, gitWatcher, eventBus);
```

Make `eventBus` available at the test file scope (same pattern as session.service.test.ts).

- [x] **Step 7: Run all backend tests**

Run: `cd packages/backend && bun test`
Expected: All tests PASS

- [x] **Step 8: Commit**

```bash
git add packages/backend/src/services/repository.service.ts packages/backend/src/server.ts packages/backend/tests/helpers/build-app.ts packages/backend/tests/services/repository.service.test.ts
git commit -m "feat(backend): emit repository:opened/closed events, cascade session destroy on repo close"
```

---

## Task 4: Update DELETE route and WebSocket forwarding

**Files:**
- Modify: `packages/backend/src/routes/session.routes.ts`
- Modify: `packages/backend/src/routes/ws.routes.ts`
- Modify: `packages/backend/tests/routes/session.routes.test.ts`

- [x] **Step 1: Write test for DELETE with force query param**

Add to `packages/backend/tests/routes/session.routes.test.ts`:

```typescript
test("DELETE /sessions/:id returns 409 when session has dirty worktree", async () => {
  const gitService = (await import("../../src/services/git.service")).GitService;
  const git = new gitService();
  await git.createBranch(repoPath, "feat/dirty-route");

  const created = (
    await app.inject({
      method: "POST",
      url: `/repositories/${repositoryId}/sessions`,
      payload: {
        name: "dirty-session",
        sourceBranch: "feat/dirty-route",
        workBranch: "feat/dirty-route",
        targetBranch: "main",
      },
    })
  ).json();

  // Make worktree dirty
  const fs = await import("node:fs");
  fs.writeFileSync(`${created.worktreePath}/dirty.txt`, "uncommitted");

  // DELETE without force should return 409
  const res = await app.inject({
    method: "DELETE",
    url: `/sessions/${created.id}`,
  });
  expect(res.statusCode).toBe(409);
  expect(res.json().code).toBe("DIRTY_STATE");

  // DELETE with force should succeed
  const forceRes = await app.inject({
    method: "DELETE",
    url: `/sessions/${created.id}?force=true`,
  });
  expect(forceRes.statusCode).toBe(204);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && bun test tests/routes/session.routes.test.ts`
Expected: FAIL — DELETE currently always returns 204

- [x] **Step 3: Update DELETE route to accept force and return 409**

In `packages/backend/src/routes/session.routes.ts`, update the delete handler:

```typescript
app.delete("/sessions/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const { force } = request.query as { force?: string };
  try {
    await sessionService.destroy(id, { force: force === "true" });
    return reply.status(204).send();
  } catch (err) {
    return reply.status(409).send({
      error: (err as Error).message,
      code: "DIRTY_STATE",
    });
  }
});
```

- [x] **Step 4: Add new events to WebSocket forwarding**

In `packages/backend/src/routes/ws.routes.ts`, add forwarding for the new lifecycle events. Add these `unsubs.push()` blocks after the existing ones:

```typescript
unsubs.push(
  eventBus.on("*", "session:created", (data) => {
    socket.send(
      JSON.stringify({
        event: "session:created",
        ...(data as Record<string, unknown>),
      }),
    );
  }),
);

unsubs.push(
  eventBus.on("*", "session:deleted", (data) => {
    socket.send(
      JSON.stringify({
        event: "session:deleted",
        ...(data as Record<string, unknown>),
      }),
    );
  }),
);

unsubs.push(
  eventBus.on("*", "repository:opened", (data) => {
    socket.send(
      JSON.stringify({
        event: "repository:opened",
        ...(data as Record<string, unknown>),
      }),
    );
  }),
);

unsubs.push(
  eventBus.on("*", "repository:closed", (data) => {
    socket.send(
      JSON.stringify({
        event: "repository:closed",
        ...(data as Record<string, unknown>),
      }),
    );
  }),
);
```

- [x] **Step 5: Run all backend tests**

Run: `cd packages/backend && bun test`
Expected: All tests PASS

- [x] **Step 6: Commit**

```bash
git add packages/backend/src/routes/session.routes.ts packages/backend/src/routes/ws.routes.ts packages/backend/tests/routes/session.routes.test.ts
git commit -m "feat(backend): 409 on dirty session delete, forward lifecycle events via WebSocket"
```

---

## Task 5: Frontend session delete — store and WebSocket

**Files:**
- Modify: `packages/frontend/app/stores/session.store.ts`
- Modify: `packages/frontend/app/composables/useWebSocket.ts`
- Modify: `packages/frontend/tests/stores/session.store.test.ts`

- [x] **Step 1: Write test for session store destroy action**

Add to `packages/frontend/tests/stores/session.store.test.ts`:

```typescript
test("destroy removes session from store", async () => {
  const store = useSessionStore()
  store.sessions.set("s1", {
    id: "s1",
    repositoryId: "r1",
    claudeSessionId: null,
    name: "test",
    sourceBranch: "main",
    workBranch: null,
    targetBranch: "main",
    worktreePath: null,
    state: "idle",
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
  })
  store.activeSessionByRepository.set("r1", "s1")

  store.removeSession("s1", "r1")

  expect(store.sessions.has("s1")).toBe(false)
  expect(store.activeSessionByRepository.get("r1")).toBeUndefined()
  expect(store.messages.has("s1")).toBe(false)
})
```

- [x] **Step 2: Add `destroy` and `removeSession` to session store**

In `packages/frontend/app/stores/session.store.ts`, add:

```typescript
async function destroy(sessionId: string, opts: { force?: boolean } = {}) {
  const session = sessions.value.get(sessionId)
  const query = opts.force ? '?force=true' : ''
  const response = await $fetch.raw(`${config.public.backendUrl}/sessions/${sessionId}${query}`, {
    method: 'DELETE',
    ignoreResponseError: true,
  })

  if (response.status === 409) {
    // Return the error for the UI to handle (confirmation dialog)
    const body = response._data as { error: string; code: string }
    return { blocked: true, reason: body.error }
  }

  if (session) {
    removeSession(sessionId, session.repositoryId)
  }

  return { blocked: false }
}

function removeSession(sessionId: string, repositoryId: string) {
  sessions.value.delete(sessionId)
  messages.value.delete(sessionId)

  // If deleted session was active, switch to another
  if (activeSessionByRepository.value.get(repositoryId) === sessionId) {
    const remaining = sessionsForRepository(repositoryId)
    if (remaining.length > 0) {
      activeSessionByRepository.value.set(repositoryId, remaining[0].id)
    } else {
      activeSessionByRepository.value.delete(repositoryId)
    }
  }
}
```

Add `destroy` and `removeSession` to the return statement.

- [x] **Step 3: Handle `session:deleted` in useWebSocket**

In `packages/frontend/app/composables/useWebSocket.ts`, add a case in `handleEvent()`:

```typescript
case 'session:deleted': {
  const deletedSessionId = msg.sessionId as string
  const deletedRepoId = msg.repositoryId as string
  if (deletedSessionId && deletedRepoId) {
    sessionStore.removeSession(deletedSessionId, deletedRepoId)
  }
  break
}
```

- [x] **Step 4: Run frontend tests**

Run: `cd packages/frontend && bun test`
Expected: All tests PASS

- [x] **Step 5: Commit**

```bash
git add packages/frontend/app/stores/session.store.ts packages/frontend/app/composables/useWebSocket.ts packages/frontend/tests/stores/session.store.test.ts
git commit -m "feat(frontend): add session destroy action with dirty-state handling and WS event"
```

---

## Task 6: Frontend session close button and confirmation dialog

**Files:**
- Modify: `packages/frontend/app/components/session/SessionTabBar.vue`

- [x] **Step 1: Add close button and confirmation dialog to SessionTabBar**

Replace the full content of `packages/frontend/app/components/session/SessionTabBar.vue`:

```vue
<script setup lang="ts">
import type { SessionState } from '~/types'

const props = defineProps<{
  repositoryId: string
}>()

const sessionStore = useSessionStore()
const showNewSession = ref(false)

// Delete confirmation state
const deleteTarget = ref<{ id: string; name: string } | null>(null)
const deleteReason = ref('')
const showDeleteConfirm = ref(false)

const sessions = computed(() => sessionStore.sessionsForRepository(props.repositoryId))

const stateColor: Record<SessionState, string> = {
  idle: 'neutral',
  starting: 'info',
  active: 'success',
  stopped: 'warning',
  error: 'error',
  completed: 'secondary',
}

const activeTab = computed({
  get: () => sessionStore.activeSessionId(props.repositoryId) ?? undefined,
  set: (value) => {
    if (value) sessionStore.setActive(props.repositoryId, String(value))
  },
})

async function closeSession(sessionId: string) {
  const session = sessionStore.sessions.get(sessionId)
  if (!session) return

  const result = await sessionStore.destroy(sessionId)
  if (result.blocked) {
    deleteTarget.value = { id: sessionId, name: session.name }
    deleteReason.value = result.reason ?? 'Session has unsaved work.'
    showDeleteConfirm.value = true
  }
}

async function forceDelete() {
  if (!deleteTarget.value) return
  await sessionStore.destroy(deleteTarget.value.id, { force: true })
  showDeleteConfirm.value = false
  deleteTarget.value = null
}

function cancelDelete() {
  showDeleteConfirm.value = false
  deleteTarget.value = null
}
</script>

<template>
  <div class="flex items-center border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
    <div
      v-if="sessions.length"
      class="flex items-center flex-1 min-w-0 overflow-x-auto"
    >
      <button
        v-for="session in sessions"
        :key="session.id"
        class="flex items-center gap-1.5 px-3 py-1.5 text-sm border-b-2 whitespace-nowrap transition-colors group"
        :class="[
          session.id === activeTab
            ? 'border-primary-500 text-primary-600 dark:text-primary-400'
            : 'border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'
        ]"
        @click="activeTab = session.id"
      >
        <span class="truncate max-w-32">{{ session.name }}</span>
        <UBadge
          :label="session.state"
          :color="stateColor[session.state] as any"
          variant="subtle"
          size="xs"
        />
        <UButton
          icon="i-lucide-x"
          size="xs"
          color="neutral"
          variant="ghost"
          square
          class="opacity-0 group-hover:opacity-50 hover:!opacity-100 -mr-1"
          @click.stop="closeSession(session.id)"
        />
      </button>
    </div>

    <span
      v-else
      class="flex-1 px-3 text-sm text-neutral-400 dark:text-neutral-500"
    >
      No sessions
    </span>

    <div class="flex items-center px-2">
      <UButton
        icon="i-lucide-plus"
        size="xs"
        color="neutral"
        variant="ghost"
        square
        @click="showNewSession = true"
      />
    </div>

    <SessionNewSessionDialog
      v-model:open="showNewSession"
      :repository-id="repositoryId"
      @close="showNewSession = false"
    />

    <!-- Delete confirmation dialog -->
    <UModal v-model:open="showDeleteConfirm">
      <template #content>
        <div class="p-6 space-y-4">
          <h3 class="text-lg font-semibold">Delete Session?</h3>
          <p class="text-sm text-neutral-600 dark:text-neutral-400">
            {{ deleteReason }}
          </p>
          <p class="text-sm text-neutral-500 dark:text-neutral-500">
            Deleting will remove the worktree and any uncommitted work. This cannot be undone.
          </p>
          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              color="neutral"
              variant="outline"
              @click="cancelDelete"
            />
            <UButton
              label="Delete Anyway"
              color="error"
              @click="forceDelete"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
```

- [x] **Step 2: Run frontend tests**

Run: `cd packages/frontend && bun test`
Expected: All tests PASS

- [x] **Step 3: Run lint**

Run: `task lint:check`
Expected: No new errors

- [x] **Step 4: Commit**

```bash
git add packages/frontend/app/components/session/SessionTabBar.vue
git commit -m "feat(frontend): add session close button with dirty-state confirmation dialog"
```

---

## Task 7: Run full test suite and verify

**Files:** None (verification only)

- [x] **Step 1: Run all backend tests**

Run: `cd packages/backend && bun test`
Expected: All tests PASS (62+ tests)

- [x] **Step 2: Run all frontend tests**

Run: `cd packages/frontend && bun test`
Expected: All tests PASS (42+ tests)

- [x] **Step 3: Run lint**

Run: `task lint:check`
Expected: No errors

- [x] **Step 4: Verify event coverage**

Check that all CRUD operations emit events by grepping:

```bash
grep -n "eventBus.emit" packages/backend/src/services/session.service.ts packages/backend/src/services/repository.service.ts
```

Expected output should show:
- `session:created` in SessionService.create()
- `session:deleted` in SessionService.destroy()
- `session:state-changed` in SessionService.setState()
- `repository:opened` in RepositoryService.open()
- `repository:closed` in RepositoryService.close()

Check WebSocket forwarding covers all new events:

```bash
grep -n "session:created\|session:deleted\|repository:opened\|repository:closed" packages/backend/src/routes/ws.routes.ts
```

Expected: All four events forwarded.

---

## Pending Tasks

The following tasks extend lifecycle event coverage to remaining CRUD operations and frontend event handling. They were identified during brainstorming but not included in the initial implementation scope.

---

## Task 8: Add `project:updated` lifecycle event

**Files:**
- Modify: `packages/backend/src/services/project.service.ts`
- Modify: `packages/backend/src/routes/ws.routes.ts`
- Modify: `packages/backend/tests/services/project.service.test.ts` (create if needed)

The Project entity currently has no EventBus access and emits no events. Add:

| Event | Payload | Emitted by |
|-------|---------|-----------|
| `project:updated` | `{ projectId, name }` | `ProjectService.update()` |

- [ ] **Step 1:** Inject `EventBus` into `ProjectService` constructor
- [ ] **Step 2:** Emit `project:updated` in `update()` and `getOrCreate()` (on create path)
- [ ] **Step 3:** Forward `project:updated` via WebSocket in `ws.routes.ts`
- [ ] **Step 4:** Update `server.ts` and `build-app.ts` wiring
- [ ] **Step 5:** Write tests
- [ ] **Step 6:** Commit

---

## Task 9: Add `session:updated` lifecycle event

**Files:**
- Modify: `packages/backend/src/services/session.service.ts`
- Modify: `packages/backend/src/routes/ws.routes.ts`

`SessionService.update()` changes session metadata (name, targetBranch) but emits no event. Add:

| Event | Payload | Emitted by |
|-------|---------|-----------|
| `session:updated` | `{ sessionId, repositoryId, fields }` | `SessionService.update()` |

- [ ] **Step 1:** Emit `session:updated` in `SessionService.update()`
- [ ] **Step 2:** Forward via WebSocket
- [ ] **Step 3:** Handle in frontend `useWebSocket.ts` (update session in store)
- [ ] **Step 4:** Write tests
- [ ] **Step 5:** Commit

---

## Task 10: Handle `session:created` and `repository:opened`/`closed` in frontend WebSocket

**Files:**
- Modify: `packages/frontend/app/composables/useWebSocket.ts`
- Modify: `packages/frontend/app/stores/repository.store.ts`

The backend now forwards `session:created`, `repository:opened`, and `repository:closed` via WebSocket, but the frontend `handleEvent()` only handles `session:deleted`. Add handlers for:

- `session:created` — add the session to the store (fetch full session data, or use payload if sufficient)
- `repository:opened` — add to repository store (for multi-client scenarios)
- `repository:closed` — remove from repository store, clean up associated sessions

- [ ] **Step 1:** Add `session:created` case in `handleEvent()`
- [ ] **Step 2:** Add `repository:opened` case
- [ ] **Step 3:** Add `repository:closed` case with session cleanup
- [ ] **Step 4:** Write tests
- [ ] **Step 5:** Commit

---

## Task 11: Repository close UI — confirmation with active session count

**Files:**
- Modify: `packages/frontend/app/components/repository/RepositoryTabBar.vue`
- Modify: `packages/frontend/app/stores/repository.store.ts`

The RepositoryTabBar's close button currently calls `repositoryStore.close()` immediately with no confirmation. When a repository has active sessions (especially ones with worktrees), the user should see a confirmation dialog similar to the session delete dialog.

- [ ] **Step 1:** Add confirmation dialog to RepositoryTabBar (UModal)
- [ ] **Step 2:** Show session count and names in the dialog
- [ ] **Step 3:** Warn about worktrees that will be force-deleted
- [ ] **Step 4:** Only skip confirmation when no sessions exist
- [ ] **Step 5:** Commit

---

## Task 12: Evolve EventBus to support async gate events (Approach B preparation)

**Files:**
- Modify: `packages/backend/src/infra/event-bus.ts`

Current EventBus is synchronous and fire-and-forget. When hooks arrive (iteration 4), we need abortable gate events where subscribers can block operations. This task prepares the infrastructure without changing existing behavior.

- [ ] **Step 1:** Add `emitAsync()` method that calls handlers sequentially and supports `AbortSignal`
- [ ] **Step 2:** Add typed event map for known lifecycle events (optional but recommended)
- [ ] **Step 3:** Existing `emit()` remains unchanged for backward compatibility
- [ ] **Step 4:** Write tests for async emission and abort
- [ ] **Step 5:** Commit
