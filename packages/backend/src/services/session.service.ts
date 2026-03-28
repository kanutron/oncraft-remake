import { join } from "node:path";
import type { EventBus } from "../infra/event-bus";
import type { Store } from "../infra/store";
import type { Session, SessionState } from "../types";
import type { GitService } from "./git.service";
import type { ProcessManager } from "./process-manager";

interface CreateSessionOptions {
	name: string;
	sourceBranch: string;
	targetBranch: string;
	useWorktree: boolean;
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
		this.eventBus.on("*", "git:branch-changed", (data) => {
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
		workspaceId: string,
		opts: CreateSessionOptions,
	): Promise<Session> {
		const workspace = this.store.getWorkspace(workspaceId);
		if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

		let worktreePath: string | null = null;

		if (opts.useWorktree) {
			const worktreeDir = join(
				workspace.path,
				"..",
				".oncraft-worktrees",
				opts.sourceBranch.replace(/\//g, "-"),
			);
			await this.gitService.createWorktree(
				workspace.path,
				opts.sourceBranch,
				worktreeDir,
			);
			worktreePath = worktreeDir;
		}

		const session: Session = {
			id: crypto.randomUUID(),
			workspaceId,
			claudeSessionId: null,
			name: opts.name,
			sourceBranch: opts.sourceBranch,
			targetBranch: opts.targetBranch,
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

	list(workspaceId: string): Session[] {
		return this.store.listSessions(workspaceId);
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

		const workspace = this.store.getWorkspace(session.workspaceId);
		if (!workspace)
			throw new Error(`Workspace not found: ${session.workspaceId}`);

		const cwd = session.worktreePath ?? workspace.path;

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
			const workspace = this.store.getWorkspace(session.workspaceId);
			if (!workspace) throw new Error("Workspace not found");
			const cwd = session.worktreePath ?? workspace.path;
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
			const workspace = this.store.getWorkspace(session.workspaceId);
			if (workspace) {
				try {
					await this.gitService.removeWorktree(
						workspace.path,
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

		const workspace = this.store.getWorkspace(session.workspaceId);
		if (!workspace) return;

		const allSessions = this.store.listSessions(session.workspaceId);
		const worktreePath = session.worktreePath ?? workspace.path;

		const conflicts = allSessions.filter(
			(s) =>
				s.id !== sessionId &&
				s.state === "active" &&
				(s.worktreePath ?? workspace.path) === worktreePath,
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
		const workspace = session
			? this.store.getWorkspace(session.workspaceId)
			: null;
		const path = session?.worktreePath ?? workspace?.path ?? "*";
		this.eventBus.emit(path, "session:state", { sessionId, from, to: state });
	}

	private handleBranchChange(path: string, from: string, to: string): void {
		const allWorkspaces = this.store.listWorkspaces();
		for (const ws of allWorkspaces) {
			const sessions = this.store.listSessions(ws.id);
			for (const session of sessions) {
				const sessionPath = session.worktreePath ?? ws.path;
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
