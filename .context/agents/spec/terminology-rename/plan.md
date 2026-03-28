# Terminology Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename domain model from Workspace/Session to Project/Repository/Session across the full stack.

**Architecture:** Mechanical rename — no structural changes. Backend types flow through store → services → routes → server. Frontend mirrors the types and consumes the API. Tests mirror the source. A minimal Project entity is added last. All tasks are completed against the existing `master` branch in a dedicated worktree.

**Tech Stack:** Bun + Fastify backend, Nuxt 4 frontend (Pinia stores, NuxtUI v4), SQLite (bun:sqlite), Vitest (frontend tests), Bun test (backend tests), pnpm monorepo.

**Important:** After renaming, any existing `oncraft.db` file must be deleted — the schema changes are not backward-compatible. This is acceptable for early development.

**Spec:** `.context/agents/spec/terminology-rename/design.md`

---

## Task 1: Rename backend types

The type definitions are the foundation. Everything else depends on these.

**Files:**
- Modify: `packages/backend/src/types/index.ts`

- [ ] **Step 1: Rename Workspace → Repository, workspaceId → repositoryId, event names**

Replace the full content of `packages/backend/src/types/index.ts`:

```typescript
export interface Repository {
	id: string;
	path: string;
	name: string;
	createdAt: string;
	lastOpenedAt: string;
}

export interface Session {
	id: string;
	repositoryId: string;
	claudeSessionId: string | null;
	name: string;
	sourceBranch: string;
	workBranch: string | null;
	targetBranch: string;
	worktreePath: string | null;
	state: SessionState;
	createdAt: string;
	lastActivityAt: string;
	costUsd: number;
	inputTokens: number;
	outputTokens: number;
}

export type SessionState =
	| "idle"
	| "starting"
	| "active"
	| "stopped"
	| "error"
	| "completed";

// Bridge stdin commands
export interface BridgeCommand {
	cmd:
		| "start"
		| "reply"
		| "interrupt"
		| "stop"
		| "loadHistory"
		| "listSessions";
	[key: string]: unknown;
}

// Bridge stdout events — raw SDK messages pass through, bridge adds its own types
export interface BridgeEvent {
	type: string;
	[key: string]: unknown;
}

// WebSocket server -> client events
export interface WSServerEvent {
	event: string;
	sessionId?: string;
	repositoryId?: string;
	data: unknown;
}

// WebSocket client -> server commands
export interface WSClientCommand {
	command: string;
	sessionId?: string;
	data: unknown;
}

// Git state change event (emitted by GitWatcher, path-scoped)
export interface GitChangeEvent {
	path: string;
	from: string;
	to: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/types/index.ts
git commit -m "refactor(backend): rename Workspace type to Repository"
```

---

## Task 2: Rename backend store

The SQLite persistence layer — table names, column names, and all CRUD method names.

**Files:**
- Modify: `packages/backend/src/infra/store.ts`

- [ ] **Step 1: Update store with renamed tables, columns, and methods**

Replace the full content of `packages/backend/src/infra/store.ts`:

```typescript
import { Database } from "bun:sqlite";
import type { Session, SessionState, Repository } from "../types";

export class Store {
	private db: Database;

	constructor(dbPath = "oncraft.db") {
		this.db = new Database(dbPath);
		this.db.exec("PRAGMA journal_mode = WAL");
		this.migrate();
	}

	private migrate(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS repositories (
				id TEXT PRIMARY KEY,
				path TEXT NOT NULL UNIQUE,
				name TEXT NOT NULL,
				createdAt TEXT NOT NULL,
				lastOpenedAt TEXT NOT NULL
			)
		`);
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS sessions (
				id TEXT PRIMARY KEY,
				repositoryId TEXT NOT NULL,
				claudeSessionId TEXT,
				name TEXT NOT NULL,
				sourceBranch TEXT NOT NULL,
				workBranch TEXT,
				targetBranch TEXT NOT NULL,
				worktreePath TEXT,
				state TEXT NOT NULL DEFAULT 'idle',
				createdAt TEXT NOT NULL,
				lastActivityAt TEXT NOT NULL,
				costUsd REAL NOT NULL DEFAULT 0,
				inputTokens INTEGER NOT NULL DEFAULT 0,
				outputTokens INTEGER NOT NULL DEFAULT 0,
				FOREIGN KEY (repositoryId) REFERENCES repositories(id)
			)
		`);
	}

	// --- Repositories ---

	createRepository(repo: Repository): void {
		this.db
			.prepare(
				"INSERT INTO repositories (id, path, name, createdAt, lastOpenedAt) VALUES (?, ?, ?, ?, ?)",
			)
			.run(repo.id, repo.path, repo.name, repo.createdAt, repo.lastOpenedAt);
	}

	getRepository(id: string): Repository | null {
		return this.db
			.prepare("SELECT * FROM repositories WHERE id = ?")
			.get(id) as Repository | null;
	}

	listRepositories(): Repository[] {
		return this.db
			.prepare("SELECT * FROM repositories ORDER BY lastOpenedAt DESC")
			.all() as Repository[];
	}

	updateRepositoryLastOpened(id: string, lastOpenedAt: string): void {
		this.db
			.prepare("UPDATE repositories SET lastOpenedAt = ? WHERE id = ?")
			.run(lastOpenedAt, id);
	}

	deleteRepository(id: string): void {
		this.db.prepare("DELETE FROM repositories WHERE id = ?").run(id);
	}

	// --- Sessions ---

	createSession(s: Session): void {
		this.db
			.prepare(
				`INSERT INTO sessions (id, repositoryId, claudeSessionId, name, sourceBranch, workBranch, targetBranch,
				worktreePath, state, createdAt, lastActivityAt, costUsd, inputTokens, outputTokens)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				s.id,
				s.repositoryId,
				s.claudeSessionId,
				s.name,
				s.sourceBranch,
				s.workBranch,
				s.targetBranch,
				s.worktreePath,
				s.state,
				s.createdAt,
				s.lastActivityAt,
				s.costUsd,
				s.inputTokens,
				s.outputTokens,
			);
	}

	getSession(id: string): Session | null {
		return this.db
			.prepare("SELECT * FROM sessions WHERE id = ?")
			.get(id) as Session | null;
	}

	listSessions(repositoryId: string): Session[] {
		return this.db
			.prepare(
				"SELECT * FROM sessions WHERE repositoryId = ? ORDER BY createdAt DESC",
			)
			.all(repositoryId) as Session[];
	}

	updateSessionState(id: string, state: SessionState): void {
		this.db
			.prepare("UPDATE sessions SET state = ?, lastActivityAt = ? WHERE id = ?")
			.run(state, new Date().toISOString(), id);
	}

	updateSessionMetrics(
		id: string,
		metrics: { costUsd: number; inputTokens: number; outputTokens: number },
	): void {
		this.db
			.prepare(
				"UPDATE sessions SET costUsd = ?, inputTokens = ?, outputTokens = ? WHERE id = ?",
			)
			.run(metrics.costUsd, metrics.inputTokens, metrics.outputTokens, id);
	}

	updateClaudeSessionId(id: string, claudeSessionId: string): void {
		this.db
			.prepare("UPDATE sessions SET claudeSessionId = ? WHERE id = ?")
			.run(claudeSessionId, id);
	}

	updateSessionFields(
		id: string,
		fields: { name?: string; targetBranch?: string },
	): void {
		const sets: string[] = [];
		const values: unknown[] = [];
		if (fields.name !== undefined) {
			sets.push("name = ?");
			values.push(fields.name);
		}
		if (fields.targetBranch !== undefined) {
			sets.push("targetBranch = ?");
			values.push(fields.targetBranch);
		}
		if (sets.length === 0) return;
		values.push(id);
		this.db
			.prepare(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`)
			.run(...values);
	}

	deleteSession(id: string): void {
		this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
	}

	deleteSessionsForRepository(repositoryId: string): void {
		this.db
			.prepare("DELETE FROM sessions WHERE repositoryId = ?")
			.run(repositoryId);
	}

	close(): void {
		this.db.close();
	}
}
```

- [ ] **Step 2: Delete any existing oncraft.db (schema is not backward-compatible)**

```bash
rm -f packages/backend/oncraft.db
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/infra/store.ts
git commit -m "refactor(backend): rename workspaces table to repositories in store"
```

---

## Task 3: Rename backend services

Rename workspace.service.ts → repository.service.ts and update session.service.ts references.

**Files:**
- Create: `packages/backend/src/services/repository.service.ts` (renamed from workspace.service.ts)
- Delete: `packages/backend/src/services/workspace.service.ts`
- Modify: `packages/backend/src/services/session.service.ts`

- [ ] **Step 1: Create repository.service.ts**

Create `packages/backend/src/services/repository.service.ts`:

```typescript
import { basename } from "node:path";
import type { GitWatcher } from "../infra/git-watcher";
import type { Store } from "../infra/store";
import type { Repository } from "../types";
import type { GitService } from "./git.service";

export interface RepositoryWithBranch extends Repository {
	branch: string;
}

export class RepositoryService {
	constructor(
		private store: Store,
		private gitService: GitService,
		private gitWatcher: GitWatcher,
	) {}

	async open(path: string, name?: string): Promise<Repository> {
		const isRepo = await this.gitService.isGitRepo(path);
		if (!isRepo) throw new Error(`Not a git repository: ${path}`);

		// Check if already open
		const existing = this.store.listRepositories().find((r) => r.path === path);
		if (existing) {
			this.store.updateRepositoryLastOpened(
				existing.id,
				new Date().toISOString(),
			);
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
		this.gitWatcher.unwatch(repo.path);
		this.store.deleteSessionsForRepository(id);
		this.store.deleteRepository(id);
	}

	async closeAll(): Promise<void> {
		const repos = this.store.listRepositories();
		for (const repo of repos) {
			this.gitWatcher.unwatch(repo.path);
		}
	}
}
```

- [ ] **Step 2: Delete old workspace.service.ts**

```bash
rm packages/backend/src/services/workspace.service.ts
```

- [ ] **Step 3: Update session.service.ts**

Replace the full content of `packages/backend/src/services/session.service.ts`:

```typescript
import { join } from "node:path";
import type { EventBus } from "../infra/event-bus";
import type { Store } from "../infra/store";
import type { Session, SessionState } from "../types";
import type { GitService } from "./git.service";
import type { ProcessManager } from "./process-manager";

interface CreateSessionOptions {
	name: string;
	sourceBranch: string;
	workBranch?: string;
	targetBranch?: string;
}

interface SendOptions {
	model?: string;
	effort?: string;
	permissionMode?: string;
}

export class SessionService {
	constructor(
		private store: Store,
		private eventBus: EventBus,
		private gitService: GitService,
		private processManager: ProcessManager,
	) {
		// Subscribe to git branch changes and match to sessions
		this.eventBus.on("*", "repository:git-changed", (data) => {
			const { path, from, to } = data as {
				path: string;
				from: string;
				to: string;
			};
			this.handleBranchChange(path, from, to);
		});

		// Subscribe to process exit events
		this.eventBus.on("*", "session:process-exit", (data) => {
			const { sessionId, code } = data as {
				sessionId: string;
				code: number;
			};
			const session = this.store.getSession(sessionId);
			if (session && session.state === "active") {
				this.setState(sessionId, code === 0 ? "idle" : "error");
			}
		});

		// Subscribe to session messages to extract metrics from result events
		this.eventBus.on("*", "session:message", (data) => {
			const msg = data as {
				sessionId: string;
				type: string;
				[key: string]: unknown;
			};
			if (msg.type === "bridge:error") {
				const session = this.store.getSession(msg.sessionId);
				if (session && session.state === "active") {
					this.setState(msg.sessionId, "error");
				}
			}
			if (msg.type === "result") {
				const { sessionId, costUsd, usage } = msg as {
					sessionId: string;
					costUsd?: number;
					usage?: { inputTokens?: number; outputTokens?: number };
				};
				if (costUsd !== undefined || usage) {
					this.store.updateSessionMetrics(sessionId, {
						costUsd: costUsd ?? 0,
						inputTokens: usage?.inputTokens ?? 0,
						outputTokens: usage?.outputTokens ?? 0,
					});
					this.eventBus.emit("*", "session:result", {
						sessionId,
						costUsd,
						...usage,
					});
				}
				this.setState(sessionId, "idle");
			}
			if (
				msg.type === "system" &&
				(msg as Record<string, unknown>).subtype === "init"
			) {
				const initSessionId = (msg as Record<string, unknown>).sessionId as
					| string
					| undefined;
				if (initSessionId && msg.sessionId) {
					this.store.updateClaudeSessionId(msg.sessionId, initSessionId);
				}
			}
		});
	}

	async create(
		repositoryId: string,
		opts: CreateSessionOptions,
	): Promise<Session> {
		const repo = this.store.getRepository(repositoryId);
		if (!repo) throw new Error(`Repository not found: ${repositoryId}`);

		const workBranch = opts.workBranch || null;
		const targetBranch = opts.targetBranch || opts.sourceBranch;
		let worktreePath: string | null = null;

		if (workBranch) {
			const worktreeDir = join(
				repo.path,
				"..",
				".oncraft-worktrees",
				workBranch.replace(/\//g, "-"),
			);
			await this.gitService.createWorktree(
				repo.path,
				workBranch,
				worktreeDir,
				opts.sourceBranch,
			);
			worktreePath = worktreeDir;
		}

		const session: Session = {
			id: crypto.randomUUID(),
			repositoryId,
			claudeSessionId: null,
			name: opts.name,
			sourceBranch: opts.sourceBranch,
			workBranch,
			targetBranch,
			worktreePath,
			state: "idle",
			createdAt: new Date().toISOString(),
			lastActivityAt: new Date().toISOString(),
			costUsd: 0,
			inputTokens: 0,
			outputTokens: 0,
		};

		this.store.createSession(session);
		return session;
	}

	get(id: string): Session | null {
		return this.store.getSession(id);
	}

	list(repositoryId: string): Session[] {
		return this.store.listSessions(repositoryId);
	}

	update(id: string, fields: { name?: string; targetBranch?: string }): void {
		this.store.updateSessionFields(id, fields);
	}

	async send(
		sessionId: string,
		message: string,
		opts: SendOptions = {},
	): Promise<void> {
		const session = this.store.getSession(sessionId);
		if (!session) throw new Error(`Session not found: ${sessionId}`);
		if (session.state === "completed" || session.state === "error") {
			throw new Error(`Cannot send to session in ${session.state} state`);
		}

		const repo = this.store.getRepository(session.repositoryId);
		if (!repo)
			throw new Error(`Repository not found: ${session.repositoryId}`);

		const cwd = session.worktreePath ?? repo.path;

		this.checkWorktreeConflict(sessionId, "active");

		if (!this.processManager.isAlive(sessionId)) {
			this.setState(sessionId, "starting");
			await this.processManager.spawn(sessionId, cwd);
			await this.processManager.waitForReady(sessionId);
		}

		this.setState(sessionId, "active");

		this.processManager.send(sessionId, {
			cmd: "start",
			projectPath: cwd,
			prompt: message,
			sessionId: session.claudeSessionId ?? undefined,
			model: opts.model,
			effort: opts.effort,
			permissionMode: opts.permissionMode,
		});
	}

	reply(
		sessionId: string,
		toolUseID: string,
		decision: "allow" | "deny",
	): void {
		this.processManager.send(sessionId, { cmd: "reply", toolUseID, decision });
	}

	interrupt(sessionId: string): void {
		this.processManager.send(sessionId, { cmd: "interrupt" });
		this.setState(sessionId, "idle");
	}

	async stop(sessionId: string): Promise<void> {
		await this.processManager.stop(sessionId);
		this.setState(sessionId, "stopped");
	}

	async resume(sessionId: string): Promise<void> {
		const session = this.store.getSession(sessionId);
		if (!session) throw new Error(`Session not found: ${sessionId}`);
		if (!session.claudeSessionId)
			throw new Error("No Claude session to resume");
		this.setState(sessionId, "idle");
	}

	async loadHistory(sessionId: string): Promise<void> {
		const session = this.store.getSession(sessionId);
		if (!session) throw new Error(`Session not found: ${sessionId}`);
		if (!this.processManager.isAlive(sessionId)) {
			const repo = this.store.getRepository(session.repositoryId);
			if (!repo) throw new Error("Repository not found");
			const cwd = session.worktreePath ?? repo.path;
			await this.processManager.spawn(sessionId, cwd);
			await this.processManager.waitForReady(sessionId);
		}
		this.processManager.send(sessionId, {
			cmd: "loadHistory",
			sessionId: session.claudeSessionId,
		});
	}

	async destroy(sessionId: string): Promise<void> {
		const session = this.store.getSession(sessionId);
		if (!session) return;

		if (this.processManager.isAlive(sessionId)) {
			await this.processManager.stop(sessionId);
		}

		if (session.worktreePath) {
			const repo = this.store.getRepository(session.repositoryId);
			if (repo) {
				try {
					await this.gitService.removeWorktree(
						repo.path,
						session.worktreePath,
					);
				} catch {
					/* worktree may already be gone */
				}
			}
		}

		this.store.deleteSession(sessionId);
	}

	checkWorktreeConflict(sessionId: string, newState: SessionState): void {
		if (newState !== "active") return;

		const session = this.store.getSession(sessionId);
		if (!session) return;

		const repo = this.store.getRepository(session.repositoryId);
		if (!repo) return;

		const allSessions = this.store.listSessions(session.repositoryId);
		const worktreePath = session.worktreePath ?? repo.path;

		const conflicts = allSessions.filter(
			(s) =>
				s.id !== sessionId &&
				s.state === "active" &&
				(s.worktreePath ?? repo.path) === worktreePath,
		);

		if (conflicts.length > 0) {
			this.eventBus.emit(worktreePath, "session:worktree-conflict", {
				sessionId,
				conflictsWith: conflicts.map((s) => s.id),
				worktreePath,
			});
		}
	}

	private setState(sessionId: string, state: SessionState): void {
		const session = this.store.getSession(sessionId);
		const from = session?.state ?? "idle";
		this.store.updateSessionState(sessionId, state);
		const repo = session
			? this.store.getRepository(session.repositoryId)
			: null;
		const path = session?.worktreePath ?? repo?.path ?? "*";
		this.eventBus.emit(path, "session:state-changed", {
			sessionId,
			repositoryId: session?.repositoryId,
			from,
			to: state,
		});
	}

	private handleBranchChange(path: string, from: string, to: string): void {
		const allRepos = this.store.listRepositories();
		for (const repo of allRepos) {
			const sessions = this.store.listSessions(repo.id);
			for (const session of sessions) {
				const sessionPath = session.worktreePath ?? repo.path;
				if (sessionPath === path && session.sourceBranch !== to) {
					this.eventBus.emit(path, "session:branch-mismatch", {
						sessionId: session.id,
						expected: session.sourceBranch,
						actual: to,
						from,
					});

					if (
						session.state === "active" &&
						this.processManager.isAlive(session.id)
					) {
						this.processManager.send(session.id, { cmd: "interrupt" });
					}
				}
			}
		}
	}
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/services/repository.service.ts packages/backend/src/services/session.service.ts
git rm packages/backend/src/services/workspace.service.ts
git commit -m "refactor(backend): rename WorkspaceService to RepositoryService, update SessionService"
```

---

## Task 4: Rename backend routes and update git-watcher event

Rename workspace.routes.ts → repository.routes.ts, update all route paths and references.

**Files:**
- Create: `packages/backend/src/routes/repository.routes.ts` (renamed from workspace.routes.ts)
- Delete: `packages/backend/src/routes/workspace.routes.ts`
- Modify: `packages/backend/src/routes/session.routes.ts`
- Modify: `packages/backend/src/routes/git.routes.ts`
- Modify: `packages/backend/src/routes/ws.routes.ts`
- Modify: `packages/backend/src/infra/git-watcher.ts`
- Modify: `packages/backend/src/server.ts`

- [ ] **Step 1: Create repository.routes.ts**

Create `packages/backend/src/routes/repository.routes.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { RepositoryService } from "../services/repository.service";

export function registerRepositoryRoutes(
	app: FastifyInstance,
	repositoryService: RepositoryService,
): void {
	app.post("/repositories", async (request, reply) => {
		const { path, name } = request.body as { path: string; name?: string };
		try {
			const repo = await repositoryService.open(path, name);
			return repo;
		} catch (err) {
			return reply
				.status(400)
				.send({ error: (err as Error).message, code: "INVALID_PATH" });
		}
	});

	app.get("/repositories", async () => {
		return repositoryService.list();
	});

	app.get("/repositories/:id", async (request, reply) => {
		const { id } = request.params as { id: string };
		const repo = await repositoryService.get(id);
		if (!repo)
			return reply
				.status(404)
				.send({ error: "Repository not found", code: "NOT_FOUND" });
		return repo;
	});

	app.delete("/repositories/:id", async (request, reply) => {
		const { id } = request.params as { id: string };
		await repositoryService.close(id);
		return reply.status(204).send();
	});
}
```

- [ ] **Step 2: Delete old workspace.routes.ts**

```bash
rm packages/backend/src/routes/workspace.routes.ts
```

- [ ] **Step 3: Update session.routes.ts — change /workspaces/ to /repositories/ and param names**

Replace the full content of `packages/backend/src/routes/session.routes.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { SessionService } from "../services/session.service";

export function registerSessionRoutes(
	app: FastifyInstance,
	sessionService: SessionService,
): void {
	app.post("/repositories/:repositoryId/sessions", async (request, reply) => {
		const { repositoryId } = request.params as { repositoryId: string };
		const { name, sourceBranch, workBranch, targetBranch } = request.body as {
			name: string;
			sourceBranch: string;
			workBranch?: string;
			targetBranch?: string;
		};
		if (!sourceBranch) {
			return reply.status(400).send({
				error: "sourceBranch is required",
				code: "VALIDATION",
			});
		}
		try {
			return await sessionService.create(repositoryId, {
				name,
				sourceBranch,
				workBranch,
				targetBranch,
			});
		} catch (err) {
			return reply
				.status(400)
				.send({ error: (err as Error).message, code: "CREATE_FAILED" });
		}
	});

	app.get("/repositories/:repositoryId/sessions", async (request) => {
		const { repositoryId } = request.params as { repositoryId: string };
		return sessionService.list(repositoryId);
	});

	app.get("/sessions/:id", async (request, reply) => {
		const { id } = request.params as { id: string };
		const session = sessionService.get(id);
		if (!session)
			return reply
				.status(404)
				.send({ error: "Session not found", code: "NOT_FOUND" });
		return session;
	});

	app.patch("/sessions/:id", async (request, reply) => {
		const { id } = request.params as { id: string };
		const session = sessionService.get(id);
		if (!session)
			return reply
				.status(404)
				.send({ error: "Session not found", code: "NOT_FOUND" });
		const updates = request.body as {
			name?: string;
			targetBranch?: string;
		};
		sessionService.update(id, updates);
		return sessionService.get(id);
	});

	app.get("/sessions/:id/history", async (request, reply) => {
		const { id } = request.params as { id: string };
		try {
			await sessionService.loadHistory(id);
			return { sessionId: id, status: "loading" };
		} catch (err) {
			return reply
				.status(400)
				.send({ error: (err as Error).message, code: "HISTORY_FAILED" });
		}
	});

	app.delete("/sessions/:id", async (request, reply) => {
		const { id } = request.params as { id: string };
		await sessionService.destroy(id);
		return reply.status(204).send();
	});

	app.post("/sessions/:id/send", async (request, reply) => {
		const { id } = request.params as { id: string };
		const { message, model, effort, permissionMode } = request.body as {
			message: string;
			model?: string;
			effort?: string;
			permissionMode?: string;
		};
		try {
			await sessionService.send(id, message, {
				model,
				effort,
				permissionMode,
			});
			return reply.status(202).send({ sessionId: id });
		} catch (err) {
			return reply
				.status(400)
				.send({ error: (err as Error).message, code: "SEND_FAILED" });
		}
	});

	app.post("/sessions/:id/reply", async (request, reply) => {
		const { id } = request.params as { id: string };
		const { toolUseID, decision } = request.body as {
			toolUseID: string;
			decision: "allow" | "deny";
		};
		sessionService.reply(id, toolUseID, decision);
		return { sessionId: id };
	});

	app.post("/sessions/:id/interrupt", async (request) => {
		const { id } = request.params as { id: string };
		sessionService.interrupt(id);
		return { sessionId: id, state: "idle" };
	});

	app.post("/sessions/:id/stop", async (request) => {
		const { id } = request.params as { id: string };
		await sessionService.stop(id);
		return { sessionId: id, state: "stopped" };
	});

	app.post("/sessions/:id/resume", async (request, reply) => {
		const { id } = request.params as { id: string };
		try {
			await sessionService.resume(id);
			return sessionService.get(id);
		} catch (err) {
			return reply
				.status(400)
				.send({ error: (err as Error).message, code: "RESUME_FAILED" });
		}
	});
}
```

- [ ] **Step 4: Update git.routes.ts — change /workspaces/ to /repositories/ and use RepositoryService**

Replace the full content of `packages/backend/src/routes/git.routes.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { GitService } from "../services/git.service";
import type { RepositoryService } from "../services/repository.service";

export function registerGitRoutes(
	app: FastifyInstance,
	repositoryService: RepositoryService,
	gitService: GitService,
): void {
	async function getRepoPath(id: string): Promise<string> {
		const repo = await repositoryService.get(id);
		if (!repo) throw new Error("Repository not found");
		return repo.path;
	}

	app.get("/repositories/:id/git/status", async (request, reply) => {
		const { id } = request.params as { id: string };
		try {
			const path = await getRepoPath(id);
			return await gitService.getStatus(path);
		} catch (err) {
			return reply
				.status(404)
				.send({ error: (err as Error).message, code: "NOT_FOUND" });
		}
	});

	app.get("/repositories/:id/git/branches", async (request, reply) => {
		const { id } = request.params as { id: string };
		try {
			const path = await getRepoPath(id);
			return await gitService.listBranches(path);
		} catch (err) {
			return reply
				.status(404)
				.send({ error: (err as Error).message, code: "NOT_FOUND" });
		}
	});

	app.get("/repositories/:id/git/worktrees", async (request, reply) => {
		const { id } = request.params as { id: string };
		try {
			const path = await getRepoPath(id);
			return await gitService.listWorktrees(path);
		} catch (err) {
			return reply
				.status(404)
				.send({ error: (err as Error).message, code: "NOT_FOUND" });
		}
	});

	app.post("/repositories/:id/git/checkout", async (request, reply) => {
		const { id } = request.params as { id: string };
		const { branch, path: targetPath } = request.body as {
			branch: string;
			path?: string;
		};
		try {
			const repoPath = await getRepoPath(id);
			await gitService.checkout(targetPath ?? repoPath, branch);
			return { status: "ok", branch };
		} catch (err) {
			return reply
				.status(400)
				.send({ error: (err as Error).message, code: "CHECKOUT_FAILED" });
		}
	});

	app.post("/repositories/:id/git/branch", async (request, reply) => {
		const { id } = request.params as { id: string };
		const { name, from } = request.body as { name: string; from?: string };
		try {
			const path = await getRepoPath(id);
			await gitService.createBranch(path, name, from);
			return { status: "ok", branch: name };
		} catch (err) {
			return reply
				.status(400)
				.send({ error: (err as Error).message, code: "BRANCH_FAILED" });
		}
	});

	app.post("/repositories/:id/git/merge", async (request, reply) => {
		const { id } = request.params as { id: string };
		const { source } = request.body as { source: string };
		try {
			const path = await getRepoPath(id);
			await gitService.merge(path, source);
			return { status: "ok" };
		} catch (err) {
			return reply
				.status(409)
				.send({ error: (err as Error).message, code: "MERGE_CONFLICT" });
		}
	});

	app.post("/repositories/:id/git/rebase", async (request, reply) => {
		const { id } = request.params as { id: string };
		const { branch, onto } = request.body as {
			branch: string;
			onto: string;
		};
		try {
			const path = await getRepoPath(id);
			await gitService.rebase(path, branch, onto);
			return { status: "ok" };
		} catch (err) {
			return reply
				.status(409)
				.send({ error: (err as Error).message, code: "REBASE_CONFLICT" });
		}
	});
}
```

- [ ] **Step 5: Update ws.routes.ts — rename event names**

Replace the full content of `packages/backend/src/routes/ws.routes.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { EventBus } from "../infra/event-bus";
import type { SessionService } from "../services/session.service";

export function registerWSRoutes(
	app: FastifyInstance,
	eventBus: EventBus,
	sessionService: SessionService,
): void {
	app.get("/ws", { websocket: true }, (socket) => {
		const unsubs: Array<() => void> = [];

		unsubs.push(
			eventBus.on("*", "session:message", (data) => {
				socket.send(
					JSON.stringify({
						event: "session:message",
						...(data as Record<string, unknown>),
					}),
				);
			}),
		);

		unsubs.push(
			eventBus.on("*", "session:state-changed", (data) => {
				socket.send(
					JSON.stringify({
						event: "session:state-changed",
						...(data as Record<string, unknown>),
					}),
				);
			}),
		);

		unsubs.push(
			eventBus.on("*", "session:result", (data) => {
				socket.send(
					JSON.stringify({
						event: "session:result",
						...(data as Record<string, unknown>),
					}),
				);
			}),
		);

		unsubs.push(
			eventBus.on("*", "session:worktree-conflict", (data) => {
				socket.send(
					JSON.stringify({
						event: "session:worktree-conflict",
						...(data as Record<string, unknown>),
					}),
				);
			}),
		);

		unsubs.push(
			eventBus.on("*", "session:branch-mismatch", (data) => {
				socket.send(
					JSON.stringify({
						event: "session:branch-mismatch",
						...(data as Record<string, unknown>),
					}),
				);
			}),
		);

		unsubs.push(
			eventBus.on("*", "repository:git-changed", (data) => {
				socket.send(
					JSON.stringify({
						event: "repository:git-changed",
						...(data as Record<string, unknown>),
					}),
				);
			}),
		);

		unsubs.push(
			eventBus.on("*", "session:process-exit", (data) => {
				socket.send(
					JSON.stringify({
						event: "session:process-exit",
						...(data as Record<string, unknown>),
					}),
				);
			}),
		);

		socket.on("message", (raw) => {
			try {
				const msg = JSON.parse(raw.toString());
				switch (msg.command) {
					case "session:send":
						sessionService.send(msg.sessionId, msg.data.message, msg.data);
						break;
					case "session:reply":
						sessionService.reply(
							msg.sessionId,
							msg.data.toolUseID,
							msg.data.decision,
						);
						break;
					case "session:interrupt":
						sessionService.interrupt(msg.sessionId);
						break;
				}
			} catch (err) {
				socket.send(JSON.stringify({ event: "error", message: String(err) }));
			}
		});

		socket.on("close", () => {
			for (const unsub of unsubs) unsub();
		});
	});
}
```

- [ ] **Step 6: Update git-watcher.ts — rename event from git:branch-changed to repository:git-changed**

In `packages/backend/src/infra/git-watcher.ts`, change the event name in `checkBranch`:

```typescript
// Old:
this.eventBus.emit(path, "git:branch-changed", {
// New:
this.eventBus.emit(path, "repository:git-changed", {
```

- [ ] **Step 7: Update server.ts — rewire imports and service names**

Replace the full content of `packages/backend/src/server.ts`:

```typescript
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";

import { EventBus } from "./infra/event-bus";
import { GitWatcher } from "./infra/git-watcher";
import { Store } from "./infra/store";
import { registerGitRoutes } from "./routes/git.routes";
import { registerRepositoryRoutes } from "./routes/repository.routes";
import { registerSessionRoutes } from "./routes/session.routes";
import { registerWSRoutes } from "./routes/ws.routes";
import { GitService } from "./services/git.service";
import { ProcessManager } from "./services/process-manager";
import { RepositoryService } from "./services/repository.service";
import { SessionService } from "./services/session.service";

const app = Fastify({ logger: true });

// Plugins
await app.register(fastifyCors, {
	origin: process.env.CORS_ORIGIN || "http://localhost:3000",
});
await app.register(fastifyWebsocket);

// Infrastructure
const store = new Store(process.env.DB_PATH || "oncraft.db");
const eventBus = new EventBus();
const gitService = new GitService();
const gitWatcher = new GitWatcher(eventBus, gitService);
const processManager = new ProcessManager(eventBus);

// Services
const repositoryService = new RepositoryService(store, gitService, gitWatcher);
const sessionService = new SessionService(
	store,
	eventBus,
	gitService,
	processManager,
);

// Routes
app.get("/health", async () => ({ status: "ok" }));
registerRepositoryRoutes(app, repositoryService);
registerSessionRoutes(app, sessionService);
registerGitRoutes(app, repositoryService, gitService);
registerWSRoutes(app, eventBus, sessionService);

// Lifecycle
app.addHook("onClose", async () => {
	await processManager.stopAll();
	await gitWatcher.unwatchAll();
	store.close();
});

// Start
const port = Number(process.env.PORT) || 3001;
await app.listen({ port, host: "0.0.0.0" });
console.log(`OnCraft backend listening on port ${port}`);
```

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/routes/repository.routes.ts packages/backend/src/routes/session.routes.ts packages/backend/src/routes/git.routes.ts packages/backend/src/routes/ws.routes.ts packages/backend/src/infra/git-watcher.ts packages/backend/src/server.ts
git rm packages/backend/src/routes/workspace.routes.ts
git commit -m "refactor(backend): rename routes and events to repository terminology"
```

---

## Task 5: Update all backend tests

Update every backend test file to use the new naming.

**Files:**
- Modify: `packages/backend/tests/infra/store.test.ts`
- Modify: `packages/backend/tests/services/workspace.service.test.ts` → rename to `repository.service.test.ts`
- Modify: `packages/backend/tests/services/session.service.test.ts`
- Modify: `packages/backend/tests/routes/workspace.routes.test.ts` → rename to `repository.routes.test.ts`
- Modify: `packages/backend/tests/routes/session.routes.test.ts`
- Modify: `packages/backend/tests/routes/git.routes.test.ts`
- Modify: `packages/backend/tests/integration/full-flow.test.ts`

- [ ] **Step 1: Update store.test.ts**

Apply these renames throughout `packages/backend/tests/infra/store.test.ts`:
- `createWorkspace` → `createRepository`
- `getWorkspace` → `getRepository`
- `listWorkspaces` → `listRepositories`
- `deleteWorkspace` → `deleteRepository`
- `updateWorkspaceLastOpened` → `updateRepositoryLastOpened`
- `deleteSessionsForWorkspace` → `deleteSessionsForRepository`
- `workspaceId` → `repositoryId` (in session objects)
- All test descriptions: "workspace" → "repository"
- The `Workspace` type data: keep field structure (id, path, name, etc.)

- [ ] **Step 2: Rename workspace.service.test.ts → repository.service.test.ts and update content**

Create `packages/backend/tests/services/repository.service.test.ts` with updated content:
- Import `RepositoryService` from `../../src/services/repository.service`
- Rename all `WorkspaceService` → `RepositoryService`
- Rename all `workspaceService` → `repositoryService`
- Rename all `workspace` local vars → `repo`
- Update test descriptions
- Delete old `workspace.service.test.ts`

```bash
git rm packages/backend/tests/services/workspace.service.test.ts
```

- [ ] **Step 3: Update session.service.test.ts**

Apply these renames throughout `packages/backend/tests/services/session.service.test.ts`:
- `workspaceId` → `repositoryId` (in session creation params and assertions)
- `store.createWorkspace` → `store.createRepository`
- `Workspace not found` → `Repository not found` (error message assertion)
- `"git:branch-changed"` → `"repository:git-changed"` (event name)
- `"session:state"` → `"session:state-changed"` (event name)

- [ ] **Step 4: Rename workspace.routes.test.ts → repository.routes.test.ts and update content**

Create `packages/backend/tests/routes/repository.routes.test.ts` with updated content:
- All `/workspaces` paths → `/repositories`
- `workspaceService` → `repositoryService`
- `WorkspaceService` → `RepositoryService`
- Import paths updated
- Test descriptions updated
- Delete old `workspace.routes.test.ts`

```bash
git rm packages/backend/tests/routes/workspace.routes.test.ts
```

- [ ] **Step 5: Update session.routes.test.ts**

Apply these renames throughout `packages/backend/tests/routes/session.routes.test.ts`:
- `/workspaces/${workspaceId}/sessions` → `/repositories/${repositoryId}/sessions`
- `workspaceId` variables → `repositoryId`
- `store.createWorkspace` → `store.createRepository`
- `workspaceId` in session objects → `repositoryId`

- [ ] **Step 6: Update git.routes.test.ts**

Apply these renames throughout `packages/backend/tests/routes/git.routes.test.ts`:
- `/workspaces/${id}/git/` → `/repositories/${id}/git/`
- `workspaceService` → `repositoryService`
- `WorkspaceService` → `RepositoryService`
- Import from `repository.service` instead of `workspace.service`
- `store.createWorkspace` → `store.createRepository`
- `workspaceId` → `repositoryId`

- [ ] **Step 7: Update full-flow.test.ts**

Apply these renames throughout `packages/backend/tests/integration/full-flow.test.ts`:
- All `/workspaces` API paths → `/repositories`
- `workspaceId` → `repositoryId`
- `workspace` variables → `repo`
- Test descriptions: "workspace" → "repository"

- [ ] **Step 8: Run all backend tests**

```bash
task test:backend
```

Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/backend/tests/
git commit -m "test(backend): update all tests for repository terminology"
```

---

## Task 6: Rename frontend types, stores, and composables

**Files:**
- Modify: `packages/frontend/app/types/index.ts`
- Create: `packages/frontend/app/stores/repository.store.ts` (renamed from workspace.store.ts)
- Delete: `packages/frontend/app/stores/workspace.store.ts`
- Modify: `packages/frontend/app/stores/session.store.ts`
- Modify: `packages/frontend/app/composables/useWebSocket.ts`

- [ ] **Step 1: Update frontend types/index.ts**

Replace the full content of `packages/frontend/app/types/index.ts`:

```typescript
// Mirror backend types — keep in sync manually for now
// (shared package is a future optimization)

export interface Repository {
  id: string
  path: string
  name: string
  branch?: string // only present on GET /:id
  createdAt: string
  lastOpenedAt: string
}

export interface Session {
  id: string
  repositoryId: string
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
```

- [ ] **Step 2: Create repository.store.ts**

Create `packages/frontend/app/stores/repository.store.ts`:

```typescript
import type { Repository } from '~/types'

export const useRepositoryStore = defineStore('repository', () => {
  const config = useRuntimeConfig()
  const repositories = ref<Map<string, Repository>>(new Map())
  const activeRepositoryId = ref<string | null>(null)

  const activeRepository = computed(() =>
    activeRepositoryId.value ? repositories.value.get(activeRepositoryId.value) ?? null : null
  )

  const sortedRepositories = computed(() =>
    Array.from(repositories.value.values()).sort((a, b) =>
      new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime()
    )
  )

  async function fetchAll() {
    const data = await $fetch<Repository[]>(`${config.public.backendUrl}/repositories`)
    repositories.value = new Map(data.map(r => [r.id, r]))
    if (!activeRepositoryId.value && data.length > 0) {
      const sorted = [...data].sort((a, b) =>
        new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime()
      )
      activeRepositoryId.value = sorted[0].id
    }
  }

  async function open(path: string, name?: string) {
    const repo = await $fetch<Repository>(`${config.public.backendUrl}/repositories`, {
      method: 'POST',
      body: { path, name },
    })
    repositories.value.set(repo.id, repo)
    activeRepositoryId.value = repo.id
    return repo
  }

  async function close(id: string) {
    await $fetch(`${config.public.backendUrl}/repositories/${id}`, { method: 'DELETE' })
    repositories.value.delete(id)
    if (activeRepositoryId.value === id) {
      activeRepositoryId.value = sortedRepositories.value[0]?.id ?? null
    }
  }

  function setActive(id: string) {
    activeRepositoryId.value = id
  }

  return { repositories, activeRepositoryId, activeRepository, sortedRepositories, fetchAll, open, close, setActive }
})
```

- [ ] **Step 3: Delete old workspace.store.ts**

```bash
rm packages/frontend/app/stores/workspace.store.ts
```

- [ ] **Step 4: Update session.store.ts**

Replace the full content of `packages/frontend/app/stores/session.store.ts`:

```typescript
import type { Session, SessionState, ChatMessage } from '~/types'

export const useSessionStore = defineStore('session', () => {
  const config = useRuntimeConfig()
  const sessions = ref<Map<string, Session>>(new Map())
  const messages = ref<Map<string, ChatMessage[]>>(new Map())
  const activeSessionByRepository = ref<Map<string, string>>(new Map())

  function activeSessionId(repositoryId: string): string | null {
    return activeSessionByRepository.value.get(repositoryId) ?? null
  }

  function sessionsForRepository(repositoryId: string): Session[] {
    return Array.from(sessions.value.values())
      .filter(s => s.repositoryId === repositoryId)
      .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime())
  }

  function messagesForSession(sessionId: string): ChatMessage[] {
    return messages.value.get(sessionId) ?? []
  }

  async function fetchForRepository(repositoryId: string) {
    const data = await $fetch<Session[]>(`${config.public.backendUrl}/repositories/${repositoryId}/sessions`)
    for (const s of data) {
      sessions.value.set(s.id, s)
    }
  }

  async function create(repositoryId: string, opts: { name: string; sourceBranch: string; workBranch?: string; targetBranch?: string }) {
    const session = await $fetch<Session>(`${config.public.backendUrl}/repositories/${repositoryId}/sessions`, {
      method: 'POST',
      body: opts,
    })
    sessions.value.set(session.id, session)
    activeSessionByRepository.value.set(repositoryId, session.id)
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

  function setActive(repositoryId: string, sessionId: string) {
    activeSessionByRepository.value.set(repositoryId, sessionId)
  }

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

  function updateState(sessionId: string, state: SessionState) {
    const session = sessions.value.get(sessionId)
    if (session) {
      session.state = state
    }
  }

  return {
    sessions, messages, activeSessionByRepository,
    activeSessionId, sessionsForRepository, messagesForSession,
    fetchForRepository, create, send, reply, interrupt, setActive,
    appendMessage, updateState,
  }
})
```

- [ ] **Step 5: Update useWebSocket.ts — rename event names**

Replace the full content of `packages/frontend/app/composables/useWebSocket.ts`:

```typescript
import type { SessionState } from '~/types'

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
      case 'session:state-changed':
        if (sessionId) {
          const to = msg.to as string
          sessionStore.updateState(sessionId, to as SessionState)
        }
        break
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

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/app/types/index.ts packages/frontend/app/stores/repository.store.ts packages/frontend/app/stores/session.store.ts packages/frontend/app/composables/useWebSocket.ts
git rm packages/frontend/app/stores/workspace.store.ts
git commit -m "refactor(frontend): rename workspace types and stores to repository"
```

---

## Task 7: Rename frontend Vue components

Update all Vue components that reference workspace terminology.

**Files:**
- Rename: `packages/frontend/app/components/workspace/WorkspaceTabBar.vue` → `repository/RepositoryTabBar.vue`
- Rename: `packages/frontend/app/components/workspace/WorkspaceSelector.vue` → `repository/RepositorySelector.vue`
- Rename: `packages/frontend/app/components/workspace/WorkspaceView.vue` → `repository/RepositoryView.vue`
- Modify: `packages/frontend/app/components/session/NewSessionDialog.vue`
- Modify: `packages/frontend/app/components/session/SessionTabBar.vue`
- Modify: `packages/frontend/app/app.vue`

- [ ] **Step 1: Create repository component directory**

```bash
mkdir -p packages/frontend/app/components/repository
```

- [ ] **Step 2: Create RepositoryTabBar.vue**

Create `packages/frontend/app/components/repository/RepositoryTabBar.vue`:

```vue
<script setup lang="ts">
const repositoryStore = useRepositoryStore()

const showSelector = ref(false)

function selectRepository(id: string) {
  repositoryStore.setActive(id)
}

function closeRepository(id: string) {
  repositoryStore.close(id)
}
</script>

<template>
  <div class="flex items-center border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
    <div class="flex items-center flex-1 min-w-0 overflow-x-auto">
      <button
        v-for="repo in repositoryStore.sortedRepositories"
        :key="repo.id"
        class="flex items-center gap-1 px-3 py-1.5 text-sm border-b-2 whitespace-nowrap transition-colors"
        :class="[
          repo.id === repositoryStore.activeRepositoryId
            ? 'border-primary-500 text-primary-600 dark:text-primary-400'
            : 'border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'
        ]"
        @click="selectRepository(repo.id)"
      >
        <span class="truncate max-w-40">{{ repo.name }}</span>
        <UButton
          icon="i-lucide-x"
          size="xs"
          color="neutral"
          variant="ghost"
          square
          class="ml-1 opacity-50 hover:opacity-100"
          @click.stop="closeRepository(repo.id)"
        />
      </button>
    </div>

    <div class="flex items-center px-2 shrink-0">
      <UButton
        icon="i-lucide-plus"
        size="xs"
        color="neutral"
        variant="ghost"
        square
        @click="showSelector = true"
      />
    </div>

    <RepositorySelector
      v-model:open="showSelector"
      @close="showSelector = false"
    />
  </div>
</template>
```

- [ ] **Step 3: Create RepositorySelector.vue**

Create `packages/frontend/app/components/repository/RepositorySelector.vue`:

```vue
<script setup lang="ts">
const props = withDefaults(defineProps<{
  /** When true, renders inside a UModal. When false, renders the form inline. */
  modal?: boolean
}>(), {
  modal: true,
})

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  close: []
}>()

const repositoryStore = useRepositoryStore()

const path = ref('')
const name = ref('')
const loading = ref(false)

async function submit() {
  if (!path.value.trim()) return

  loading.value = true
  try {
    await repositoryStore.open(path.value.trim(), name.value.trim() || undefined)
    path.value = ''
    name.value = ''
    open.value = false
    emit('close')
  } finally {
    loading.value = false
  }
}

function cancel() {
  open.value = false
  emit('close')
}
</script>

<template>
  <!-- Modal mode: triggered from RepositoryTabBar -->
  <UModal
    v-if="modal"
    v-model:open="open"
    title="Add Repository"
    description="Add a git repository to this project."
  >
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Repository path</label>
          <UInput
            v-model="path"
            placeholder="/path/to/repository"
            icon="i-lucide-folder"
            autofocus
            required
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Name (optional)</label>
          <UInput
            v-model="name"
            placeholder="Display name"
            icon="i-lucide-tag"
          />
        </div>

        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="cancel"
          />
          <UButton
            label="Add"
            type="submit"
            :loading="loading"
            :disabled="!path.trim()"
          />
        </div>
      </form>
    </template>
  </UModal>

  <!-- Inline mode: empty state when no repositories are open -->
  <div v-else class="w-full max-w-md p-6">
    <h2 class="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
      Add Repository
    </h2>
    <p class="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
      Add a git repository to get started.
    </p>

    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Repository path</label>
        <UInput
          v-model="path"
          placeholder="/path/to/repository"
          icon="i-lucide-folder"
          autofocus
          required
        />
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Name (optional)</label>
        <UInput
          v-model="name"
          placeholder="Display name"
          icon="i-lucide-tag"
        />
      </div>

      <div class="flex justify-end">
        <UButton
          label="Add Repository"
          type="submit"
          :loading="loading"
          :disabled="!path.trim()"
        />
      </div>
    </form>
  </div>
</template>
```

- [ ] **Step 4: Create RepositoryView.vue**

Create `packages/frontend/app/components/repository/RepositoryView.vue`:

```vue
<script setup lang="ts">
import type { Repository } from '~/types'

const props = defineProps<{
  repository: Repository
}>()

const sessionStore = useSessionStore()

const activeSessionId = computed(() => sessionStore.activeSessionId(props.repository.id))
const activeSession = computed(() =>
  activeSessionId.value ? sessionStore.sessions.get(activeSessionId.value) ?? null : null
)

watch(() => props.repository.id, (id) => {
  sessionStore.fetchForRepository(id)
}, { immediate: true })
</script>

<template>
  <div class="flex flex-col h-full">
    <SessionTabBar :repository-id="repository.id" />

    <div class="flex-1 overflow-hidden">
      <SessionView
        v-if="activeSession"
        :session-id="activeSession.id"
      />
      <div
        v-else
        class="flex items-center justify-center h-full text-neutral-400 dark:text-neutral-500"
      >
        <p>No session selected. Create one to get started.</p>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 5: Delete old workspace components**

```bash
rm -r packages/frontend/app/components/workspace
```

- [ ] **Step 6: Update NewSessionDialog.vue — change workspaceId prop to repositoryId**

Replace the full content of `packages/frontend/app/components/session/NewSessionDialog.vue`:

```vue
<script setup lang="ts">
const props = defineProps<{
  repositoryId: string
}>()

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  close: []
}>()

const sessionStore = useSessionStore()

const name = ref('')
const sourceBranch = ref('')
const targetBranch = ref('')
const workIsolated = ref(false)
const workBranch = ref('')
const loading = ref(false)
const error = ref('')

const isValid = computed(() => {
  if (!name.value.trim() || !sourceBranch.value.trim()) return false
  if (workIsolated.value && !workBranch.value.trim()) return false
  return true
})

async function submit() {
  if (!isValid.value) return

  loading.value = true
  error.value = ''
  try {
    await sessionStore.create(props.repositoryId, {
      name: name.value.trim(),
      sourceBranch: sourceBranch.value.trim(),
      workBranch: workIsolated.value ? workBranch.value.trim() : undefined,
      targetBranch: targetBranch.value.trim() || undefined,
    })
    name.value = ''
    sourceBranch.value = ''
    targetBranch.value = ''
    workIsolated.value = false
    workBranch.value = ''
    open.value = false
    emit('close')
  } catch (err: unknown) {
    const msg = (err as { data?: { error?: string } })?.data?.error
    error.value = msg || 'Failed to create session'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="New Session"
    description="Create a new Claude Code session in this repository."
  >
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          :title="error"
          icon="i-lucide-alert-circle"
        />

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Session name</label>
          <UInput
            v-model="name"
            placeholder="feat/my-feature"
            icon="i-lucide-terminal"
            autofocus
            required
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Source branch</label>
          <UInput
            v-model="sourceBranch"
            placeholder="main"
            icon="i-lucide-git-branch"
            required
          />
          <span class="text-xs text-neutral-400 dark:text-neutral-500">Starting point for this session (HEAD)</span>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Target branch</label>
          <UInput
            v-model="targetBranch"
            :placeholder="sourceBranch || 'defaults to source'"
            icon="i-lucide-git-merge"
          />
          <span class="text-xs text-neutral-400 dark:text-neutral-500">Where work should merge or PR to</span>
        </div>

        <USwitch
          v-model="workIsolated"
          label="Work isolated"
          description="Create a dedicated worktree with its own branch."
        />

        <template v-if="workIsolated">
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Work branch</label>
            <UInput
              v-model="workBranch"
              placeholder="feat/my-feature"
              icon="i-lucide-git-fork"
              required
            />
            <span class="text-xs text-neutral-400 dark:text-neutral-500">Branch for this session's commits (created if it doesn't exist)</span>
          </div>

          <UAlert
            color="info"
            variant="subtle"
            icon="i-lucide-folder-tree"
            :title="`A worktree will be created for branch ${workBranch || '...'}`"
          />
        </template>

        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="open = false; emit('close')"
          />
          <UButton
            label="Create"
            type="submit"
            :loading="loading"
            :disabled="!isValid"
          />
        </div>
      </form>
    </template>
  </UModal>
</template>
```

- [ ] **Step 7: Update SessionTabBar.vue — change workspaceId prop to repositoryId**

Replace the full content of `packages/frontend/app/components/session/SessionTabBar.vue`:

```vue
<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import type { SessionState } from '~/types'

const props = defineProps<{
  repositoryId: string
}>()

const sessionStore = useSessionStore()

const showNewSession = ref(false)

const sessions = computed(() => sessionStore.sessionsForRepository(props.repositoryId))

const stateColor: Record<SessionState, string> = {
  idle: 'neutral',
  starting: 'info',
  active: 'success',
  stopped: 'warning',
  error: 'error',
  completed: 'secondary',
}

const tabItems = computed<TabsItem[]>(() =>
  sessions.value.map(s => ({
    label: s.name,
    value: s.id,
    badge: {
      label: s.state,
      color: stateColor[s.state] as 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'secondary',
      variant: 'subtle' as const,
      size: 'xs' as const,
    },
  }))
)

const activeTab = computed({
  get: () => sessionStore.activeSessionId(props.repositoryId) ?? undefined,
  set: (value) => {
    if (value) sessionStore.setActive(props.repositoryId, String(value))
  },
})
</script>

<template>
  <div class="flex items-center border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
    <UTabs
      v-if="tabItems.length"
      v-model="activeTab"
      :items="tabItems"
      :content="false"
      variant="link"
      size="sm"
      class="flex-1 min-w-0"
    />

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
  </div>
</template>
```

- [ ] **Step 8: Update app.vue**

Replace the full content of `packages/frontend/app/app.vue`:

```vue
<script setup lang="ts">
const repositoryStore = useRepositoryStore()
const { connect } = useWebSocket()

onMounted(() => {
  repositoryStore.fetchAll()
  connect()
})
</script>

<template>
  <UApp>
    <div class="flex flex-col h-screen">
      <RepositoryTabBar />
      <div class="flex-1 overflow-hidden">
        <RepositoryView
          v-if="repositoryStore.activeRepository"
          :repository="repositoryStore.activeRepository"
        />
        <div
          v-else
          class="flex items-center justify-center h-full"
        >
          <RepositorySelector :modal="false" />
        </div>
      </div>
    </div>
  </UApp>
</template>
```

- [ ] **Step 9: Commit**

```bash
git add packages/frontend/app/
git commit -m "refactor(frontend): rename workspace components and stores to repository"
```

---

## Task 8: Update frontend tests

**Files:**
- Rename: `packages/frontend/tests/stores/workspace.store.test.ts` → `repository.store.test.ts`
- Modify: `packages/frontend/tests/stores/session.store.test.ts`
- Modify: `packages/frontend/tests/setup.ts` (if it references workspace)

- [ ] **Step 1: Create repository.store.test.ts and delete workspace.store.test.ts**

Create `packages/frontend/tests/stores/repository.store.test.ts` with updated content:
- Import `useRepositoryStore` instead of `useWorkspaceStore`
- Rename all `useWorkspaceStore` → `useRepositoryStore`
- Rename all `workspaceStore` → `repositoryStore`
- Rename all `workspace` local vars → `repo`
- Rename `activeWorkspaceId` → `activeRepositoryId`
- Rename `activeWorkspace` → `activeRepository`
- Rename `sortedWorkspaces` → `sortedRepositories`
- Update all `/workspaces` API path assertions → `/repositories`
- Update all test descriptions

```bash
git rm packages/frontend/tests/stores/workspace.store.test.ts
```

- [ ] **Step 2: Update session.store.test.ts**

Apply these renames throughout `packages/frontend/tests/stores/session.store.test.ts`:
- `workspaceId` → `repositoryId` (in session objects and function calls)
- `activeSessionByWorkspace` → `activeSessionByRepository`
- `sessionsForWorkspace` → `sessionsForRepository`
- `fetchForWorkspace` → `fetchForRepository`
- `/workspaces/` API paths → `/repositories/`

- [ ] **Step 3: Update setup.ts if needed**

Check `packages/frontend/tests/setup.ts` for any workspace references and update.

- [ ] **Step 4: Run all frontend tests**

```bash
task test:frontend
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/tests/
git commit -m "test(frontend): update all tests for repository terminology"
```

---

## Task 9: Add minimal Project entity

Add the Project layer — minimal for now (type, service, route, store).

**Files:**
- Modify: `packages/backend/src/types/index.ts` (add Project type)
- Create: `packages/backend/src/services/project.service.ts`
- Create: `packages/backend/src/routes/project.routes.ts`
- Modify: `packages/backend/src/infra/store.ts` (add project table)
- Modify: `packages/backend/src/server.ts` (register project routes)
- Create: `packages/frontend/app/stores/project.store.ts`
- Modify: `packages/frontend/app/types/index.ts` (add Project type)

- [ ] **Step 1: Add Project type to backend types**

Add to the top of `packages/backend/src/types/index.ts`:

```typescript
export interface Project {
	id: string;
	name: string;
	createdAt: string;
	lastOpenedAt: string;
}
```

- [ ] **Step 2: Add project table to store**

Add to the `migrate()` method in `packages/backend/src/infra/store.ts`, after the repositories table:

```typescript
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS project (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				createdAt TEXT NOT NULL,
				lastOpenedAt TEXT NOT NULL
			)
		`);
```

Add these methods to the Store class:

```typescript
	// --- Project ---

	getProject(): Project | null {
		return this.db
			.prepare("SELECT * FROM project LIMIT 1")
			.get() as Project | null;
	}

	createProject(project: Project): void {
		this.db
			.prepare(
				"INSERT INTO project (id, name, createdAt, lastOpenedAt) VALUES (?, ?, ?, ?)",
			)
			.run(project.id, project.name, project.createdAt, project.lastOpenedAt);
	}

	updateProject(id: string, fields: { name?: string }): void {
		const sets: string[] = [];
		const values: unknown[] = [];
		if (fields.name !== undefined) {
			sets.push("name = ?");
			values.push(fields.name);
		}
		sets.push("lastOpenedAt = ?");
		values.push(new Date().toISOString());
		if (sets.length === 0) return;
		values.push(id);
		this.db
			.prepare(`UPDATE project SET ${sets.join(", ")} WHERE id = ?`)
			.run(...values);
	}
```

- [ ] **Step 3: Create project.service.ts**

Create `packages/backend/src/services/project.service.ts`:

```typescript
import type { Store } from "../infra/store";
import type { Project } from "../types";

export class ProjectService {
	constructor(private store: Store) {}

	get(): Project | null {
		return this.store.getProject();
	}

	getOrCreate(name: string): Project {
		const existing = this.store.getProject();
		if (existing) {
			this.store.updateProject(existing.id, {});
			return { ...existing, lastOpenedAt: new Date().toISOString() };
		}

		const project: Project = {
			id: crypto.randomUUID(),
			name,
			createdAt: new Date().toISOString(),
			lastOpenedAt: new Date().toISOString(),
		};
		this.store.createProject(project);
		return project;
	}

	update(fields: { name?: string }): Project | null {
		const project = this.store.getProject();
		if (!project) return null;
		this.store.updateProject(project.id, fields);
		return { ...project, ...fields, lastOpenedAt: new Date().toISOString() };
	}
}
```

- [ ] **Step 4: Create project.routes.ts**

Create `packages/backend/src/routes/project.routes.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { ProjectService } from "../services/project.service";

export function registerProjectRoutes(
	app: FastifyInstance,
	projectService: ProjectService,
): void {
	app.get("/project", async (request, reply) => {
		const project = projectService.get();
		if (!project)
			return reply
				.status(404)
				.send({ error: "No project configured", code: "NOT_FOUND" });
		return project;
	});

	app.patch("/project", async (request) => {
		const { name } = request.body as { name?: string };
		const project = projectService.update({ name });
		return project;
	});
}
```

- [ ] **Step 5: Wire project into server.ts**

In `packages/backend/src/server.ts`, add the import and wiring:

Add import:
```typescript
import { registerProjectRoutes } from "./routes/project.routes";
import { ProjectService } from "./services/project.service";
```

Add service instantiation (after `const processManager`):
```typescript
const projectService = new ProjectService(store);
```

Add route registration (after `app.get("/health", ...)`):
```typescript
registerProjectRoutes(app, projectService);
```

- [ ] **Step 6: Add Project type to frontend types**

Add to the top of `packages/frontend/app/types/index.ts`:

```typescript
export interface Project {
  id: string
  name: string
  createdAt: string
  lastOpenedAt: string
}
```

- [ ] **Step 7: Create frontend project.store.ts**

Create `packages/frontend/app/stores/project.store.ts`:

```typescript
import type { Project } from '~/types'

export const useProjectStore = defineStore('project', () => {
  const config = useRuntimeConfig()
  const project = ref<Project | null>(null)

  async function fetch() {
    try {
      project.value = await $fetch<Project>(`${config.public.backendUrl}/project`)
    } catch {
      project.value = null
    }
  }

  async function update(fields: { name?: string }) {
    project.value = await $fetch<Project>(`${config.public.backendUrl}/project`, {
      method: 'PATCH',
      body: fields,
    })
  }

  return { project, fetch, update }
})
```

- [ ] **Step 8: Run all tests**

```bash
task test:all
```

Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/backend/src/types/index.ts packages/backend/src/infra/store.ts packages/backend/src/services/project.service.ts packages/backend/src/routes/project.routes.ts packages/backend/src/server.ts packages/frontend/app/types/index.ts packages/frontend/app/stores/project.store.ts
git commit -m "feat: add minimal Project entity (type, service, route, store)"
```

---

## Task 10: Update documentation

**Files:**
- Modify: `AGENTS.md`
- Modify: `.context/agents/spec/oncraft-remake/design.md`

- [ ] **Step 1: Update AGENTS.md**

Update the Purpose section to reflect new terminology:
- "git workspaces" → "git repositories"
- Update any references to workspace in operations descriptions

- [ ] **Step 2: Update original design spec**

In `.context/agents/spec/oncraft-remake/design.md`, update terminology references to match the new Project > Repository > Session model. Reference the terminology rename spec for the full rationale.

- [ ] **Step 3: Run lint check**

```bash
task lint:check
```

Expected: Zero errors.

- [ ] **Step 4: Run full test suite**

```bash
task test:all
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md .context/agents/spec/
git commit -m "docs: update documentation for Project > Repository > Session terminology"
```

---

## Summary

| Task | What | Commit message |
|------|------|----------------|
| 1 | Backend types | `refactor(backend): rename Workspace type to Repository` |
| 2 | Backend store | `refactor(backend): rename workspaces table to repositories in store` |
| 3 | Backend services | `refactor(backend): rename WorkspaceService to RepositoryService, update SessionService` |
| 4 | Backend routes + events + server | `refactor(backend): rename routes and events to repository terminology` |
| 5 | Backend tests | `test(backend): update all tests for repository terminology` |
| 6 | Frontend types + stores + composables | `refactor(frontend): rename workspace types and stores to repository` |
| 7 | Frontend Vue components | `refactor(frontend): rename workspace components and stores to repository` |
| 8 | Frontend tests | `test(frontend): update all tests for repository terminology` |
| 9 | Add Project entity | `feat: add minimal Project entity (type, service, route, store)` |
| 10 | Documentation | `docs: update documentation for Project > Repository > Session terminology` |
