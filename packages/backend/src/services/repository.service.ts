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

	/** Late-bind to avoid circular dependency */
	setSessionService(sessionService: SessionService): void {
		this.sessionService = sessionService;
	}

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
