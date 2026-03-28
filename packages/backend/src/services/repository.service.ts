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
