import { join } from "node:path";
import { type FSWatcher, watch } from "chokidar";
import type { GitService } from "../services/git.service";
import type { EventBus } from "./event-bus";

export class GitWatcher {
	private watchers = new Map<string, FSWatcher>();
	private lastBranch = new Map<string, string>();

	constructor(
		private eventBus: EventBus,
		private gitService: GitService,
	) {}

	watch(path: string): void {
		if (this.watchers.has(path)) return;

		// Read initial branch
		this.gitService.getBranch(path).then((branch) => {
			this.lastBranch.set(path, branch);
		});

		const gitDir = join(path, ".git");
		const watcher = watch([join(gitDir, "HEAD"), join(gitDir, "refs")], {
			ignoreInitial: true,
			awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
		});

		watcher.on("change", () => this.checkBranch(path));
		watcher.on("add", () => this.checkBranch(path));

		this.watchers.set(path, watcher);
	}

	unwatch(path: string): void {
		const watcher = this.watchers.get(path);
		if (watcher) {
			watcher.close();
			this.watchers.delete(path);
			this.lastBranch.delete(path);
		}
	}

	async unwatchAll(): Promise<void> {
		const paths = [...this.watchers.keys()];
		for (const path of paths) {
			this.unwatch(path);
		}
	}

	private async checkBranch(path: string): Promise<void> {
		try {
			const currentBranch = await this.gitService.getBranch(path);
			const lastBranch = this.lastBranch.get(path);

			if (lastBranch && currentBranch !== lastBranch) {
				this.eventBus.emit(path, "repository:git-changed", {
					path,
					from: lastBranch,
					to: currentBranch,
				});
			}
			this.lastBranch.set(path, currentBranch);
		} catch {
			// Path may be in the middle of a git operation — ignore transient errors
		}
	}
}
