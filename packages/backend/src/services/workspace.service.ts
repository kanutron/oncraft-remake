import { basename } from "node:path";
import type { GitWatcher } from "../infra/git-watcher";
import type { Store } from "../infra/store";
import type { Workspace } from "../types";
import type { GitService } from "./git.service";

export interface WorkspaceWithBranch extends Workspace {
	branch: string;
}

export class WorkspaceService {
	constructor(
		private store: Store,
		private gitService: GitService,
		private gitWatcher: GitWatcher,
	) {}

	async open(path: string, name?: string): Promise<Workspace> {
		const isRepo = await this.gitService.isGitRepo(path);
		if (!isRepo) throw new Error(`Not a git repository: ${path}`);

		// Check if already open
		const existing = this.store.listWorkspaces().find((ws) => ws.path === path);
		if (existing) {
			this.store.updateWorkspaceLastOpened(
				existing.id,
				new Date().toISOString(),
			);
			return existing;
		}

		const workspace: Workspace = {
			id: crypto.randomUUID(),
			path,
			name: name ?? basename(path),
			createdAt: new Date().toISOString(),
			lastOpenedAt: new Date().toISOString(),
		};

		this.store.createWorkspace(workspace);
		this.gitWatcher.watch(path);
		return workspace;
	}

	async get(id: string): Promise<WorkspaceWithBranch | null> {
		const ws = this.store.getWorkspace(id);
		if (!ws) return null;
		const branch = await this.gitService.getBranch(ws.path);
		return { ...ws, branch };
	}

	async list(): Promise<Workspace[]> {
		return this.store.listWorkspaces();
	}

	async close(id: string): Promise<void> {
		const ws = this.store.getWorkspace(id);
		if (!ws) return;
		this.gitWatcher.unwatch(ws.path);
		this.store.deleteSessionsForWorkspace(id);
		this.store.deleteWorkspace(id);
	}

	async closeAll(): Promise<void> {
		const workspaces = this.store.listWorkspaces();
		for (const ws of workspaces) {
			this.gitWatcher.unwatch(ws.path);
		}
	}
}
