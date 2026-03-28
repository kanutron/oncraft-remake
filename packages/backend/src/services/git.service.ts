import simpleGit, {
	type BranchSummary,
	type SimpleGit,
	type StatusResult,
} from "simple-git";

export class GitService {
	private gitFor(path: string): SimpleGit {
		return simpleGit(path);
	}

	async isGitRepo(path: string): Promise<boolean> {
		try {
			return await this.gitFor(path).checkIsRepo();
		} catch {
			return false;
		}
	}

	async getBranch(path: string): Promise<string> {
		const result = await this.gitFor(path).revparse(["--abbrev-ref", "HEAD"]);
		return result.trim();
	}

	async getStatus(path: string): Promise<StatusResult> {
		return this.gitFor(path).status();
	}

	async listBranches(path: string): Promise<BranchSummary> {
		return this.gitFor(path).branch();
	}

	async createBranch(path: string, name: string, from?: string): Promise<void> {
		const args = from ? [name, from] : [name];
		await this.gitFor(path).branch(args);
	}

	async checkout(path: string, branch: string): Promise<void> {
		await this.gitFor(path).checkout(branch);
	}

	async createWorktree(
		repoPath: string,
		branch: string,
		worktreePath: string,
	): Promise<void> {
		const branches = await this.listBranches(repoPath);
		const branchExists = branches.all.includes(branch);

		if (branchExists) {
			try {
				await this.gitFor(repoPath).raw([
					"worktree",
					"add",
					worktreePath,
					branch,
				]);
			} catch (err) {
				const msg = String(err);
				if (msg.includes("already used by worktree")) {
					// Branch is checked out elsewhere — create a new branch from it
					const worktreeBranch = `oncraft/${branch}/${Date.now()}`;
					await this.gitFor(repoPath).raw([
						"worktree",
						"add",
						"-b",
						worktreeBranch,
						worktreePath,
						branch,
					]);
				} else {
					throw err;
				}
			}
		} else {
			await this.gitFor(repoPath).raw([
				"worktree",
				"add",
				"-b",
				branch,
				worktreePath,
			]);
		}
	}

	async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
		await this.gitFor(repoPath).raw([
			"worktree",
			"remove",
			worktreePath,
			"--force",
		]);
	}

	async listWorktrees(
		repoPath: string,
	): Promise<Array<{ path: string; branch: string; head: string }>> {
		const output = await this.gitFor(repoPath).raw([
			"worktree",
			"list",
			"--porcelain",
		]);
		const worktrees: Array<{ path: string; branch: string; head: string }> = [];
		let current: Record<string, string> = {};
		for (const line of output.split("\n")) {
			if (line.startsWith("worktree ")) {
				current.path = line.slice("worktree ".length);
			} else if (line.startsWith("HEAD ")) {
				current.head = line.slice("HEAD ".length);
			} else if (line.startsWith("branch ")) {
				current.branch = line.slice("branch refs/heads/".length);
			} else if (line === "") {
				if (current.path) {
					worktrees.push({
						path: current.path,
						branch: current.branch || "detached",
						head: current.head || "",
					});
				}
				current = {};
			}
		}
		return worktrees;
	}

	async merge(path: string, source: string): Promise<void> {
		await this.gitFor(path).merge([source]);
	}

	async rebase(path: string, branch: string, onto: string): Promise<void> {
		await this.gitFor(path).rebase([branch, "--onto", onto]);
	}
}
