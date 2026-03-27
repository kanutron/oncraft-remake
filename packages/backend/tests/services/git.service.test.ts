import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GitService } from "../../src/services/git.service";
import { createTestRepo } from "../helpers/test-repo";

let gitService: GitService;
let repoPath: string;
let cleanup: () => void;

beforeEach(async () => {
	const repo = await createTestRepo();
	repoPath = repo.path;
	cleanup = repo.cleanup;
	gitService = new GitService();
});

afterEach(() => cleanup());

describe("GitService - branches", () => {
	test("getBranch returns current branch", async () => {
		const branch = await gitService.getBranch(repoPath);
		expect(["main", "master"]).toContain(branch);
	});

	test("createBranch creates a new branch", async () => {
		await gitService.createBranch(repoPath, "feat/test");
		const branches = await gitService.listBranches(repoPath);
		expect(branches.all).toContain("feat/test");
	});

	test("checkout switches branch", async () => {
		await gitService.createBranch(repoPath, "feat/test");
		await gitService.checkout(repoPath, "feat/test");
		const branch = await gitService.getBranch(repoPath);
		expect(branch).toBe("feat/test");
	});
});

describe("GitService - status", () => {
	test("getStatus returns clean status for fresh repo", async () => {
		const status = await gitService.getStatus(repoPath);
		expect(status.isClean()).toBe(true);
	});
});

describe("GitService - worktrees", () => {
	test("creates and lists worktrees", async () => {
		await gitService.createBranch(repoPath, "feat/wt-test");
		const wtPath = `${repoPath}-wt`;
		await gitService.createWorktree(repoPath, "feat/wt-test", wtPath);
		const worktrees = await gitService.listWorktrees(repoPath);
		expect(worktrees.length).toBeGreaterThanOrEqual(2); // main + new
		// Verify the new worktree is on the right branch
		const wtBranch = await gitService.getBranch(wtPath);
		expect(wtBranch).toBe("feat/wt-test");
		// Cleanup
		await gitService.removeWorktree(repoPath, wtPath);
	});
});

describe("GitService - validation", () => {
	test("isGitRepo returns true for git repos", async () => {
		expect(await gitService.isGitRepo(repoPath)).toBe(true);
	});

	test("isGitRepo returns false for non-repos", async () => {
		expect(await gitService.isGitRepo("/tmp")).toBe(false);
	});
});
