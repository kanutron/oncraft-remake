import { join } from "node:path";
import type { EventBus } from "../infra/event-bus";
import type { Store } from "../infra/store";
import type { Session, SessionState } from "../types";
import type { GitService } from "./git.service";
import type { ProcessManager } from "./process-manager";

export class DirtyStateError extends Error {
	readonly code = "DIRTY_STATE" as const;
	constructor(message: string) {
		super(message);
		this.name = "DirtyStateError";
	}
}

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
				const claudeSessionId = (msg as Record<string, unknown>).session_id as
					| string
					| undefined;
				if (claudeSessionId && msg.sessionId) {
					this.store.updateClaudeSessionId(msg.sessionId, claudeSessionId);
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

		this.eventBus.emit("*", "session:created", {
			sessionId: session.id,
			repositoryId,
			name: opts.name,
		});

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
		if (!repo) throw new Error(`Repository not found: ${session.repositoryId}`);

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

		this.eventBus.emit(cwd, "session:message", {
			sessionId,
			type: "user",
			message: {
				role: "user",
				content: [{ type: "text", text: message }],
			},
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

	async loadSubagents(sessionId: string): Promise<void> {
		const session = this.store.getSession(sessionId);
		if (!session) throw new Error(`Session not found: ${sessionId}`);
		if (!session.claudeSessionId)
			throw new Error("No Claude session to load subagents for");
		if (!this.processManager.isAlive(sessionId)) {
			const repo = this.store.getRepository(session.repositoryId);
			if (!repo) throw new Error("Repository not found");
			const cwd = session.worktreePath ?? repo.path;
			await this.processManager.spawn(sessionId, cwd);
			await this.processManager.waitForReady(sessionId);
		}
		this.processManager.send(sessionId, {
			cmd: "loadSubagents",
			sessionId: session.claudeSessionId,
		});
	}

	async destroy(
		sessionId: string,
		opts: { force?: boolean } = {},
	): Promise<void> {
		const session = this.store.getSession(sessionId);
		if (!session) return;

		const repo = this.store.getRepository(session.repositoryId);

		// Safety check: inspect worktree state before deletion
		if (session.worktreePath && !opts.force && repo) {
			await this.checkWorktreeSafety(session, repo.path);
		}

		if (this.processManager.isAlive(sessionId)) {
			await this.processManager.stop(sessionId);
		}

		if (session.worktreePath && repo) {
			try {
				await this.gitService.removeWorktree(repo.path, session.worktreePath);
			} catch {
				/* worktree may already be gone */
			}
		}

		this.store.deleteSession(sessionId);

		this.eventBus.emit("*", "session:deleted", {
			sessionId,
			repositoryId: session.repositoryId,
			name: session.name,
		});
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

	private async checkWorktreeSafety(
		session: Session,
		repoPath: string,
	): Promise<void> {
		if (!session.worktreePath) return;

		// Check for uncommitted changes
		const status = await this.gitService.getStatus(session.worktreePath);
		if (status.files.length > 0) {
			throw new DirtyStateError(
				`Session "${session.name}" has uncommitted changes (${status.files.length} files). Use force to delete anyway.`,
			);
		}

		// Check for commits on work branch not merged into target
		if (session.workBranch && session.targetBranch) {
			try {
				const count = await this.gitService.getUnmergedCommitCount(
					repoPath,
					session.targetBranch,
					session.workBranch,
				);
				if (count > 0) {
					throw new DirtyStateError(
						`Session "${session.name}" has ${count} unmerged commits on "${session.workBranch}" (target: "${session.targetBranch}"). Use force to delete anyway.`,
					);
				}
			} catch (err) {
				if (err instanceof DirtyStateError) throw err;
				// git failure — skip check
			}
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
