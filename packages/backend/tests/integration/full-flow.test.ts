import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { buildApp } from "../helpers/build-app";
import { createTestRepo } from "../helpers/test-repo";

let app: Awaited<ReturnType<typeof buildApp>>;
let repoPath: string;
let cleanupRepo: () => void;

beforeEach(async () => {
	const repo = await createTestRepo();
	repoPath = repo.path;
	cleanupRepo = repo.cleanup;
	app = await buildApp();
});

afterEach(async () => {
	await app.close();
	cleanupRepo();
});

describe("Full flow integration", () => {
	test("repository -> session -> update -> cleanup lifecycle", async () => {
		// Step 1: POST /repositories with a real test repo
		const createRepoRes = await app.inject({
			method: "POST",
			url: "/repositories",
			payload: { path: repoPath, name: "integration-test" },
		});
		expect(createRepoRes.statusCode).toBe(200);
		const repository = createRepoRes.json();
		expect(repository.id).toBeTruthy();
		expect(repository.path).toBe(repoPath);
		expect(repository.name).toBe("integration-test");

		const repositoryId = repository.id;

		// Step 2: GET /repositories/:id — verify branch is returned
		const getRepoRes = await app.inject({
			method: "GET",
			url: `/repositories/${repositoryId}`,
		});
		expect(getRepoRes.statusCode).toBe(200);
		const repoWithBranch = getRepoRes.json();
		expect(repoWithBranch.branch).toBeTruthy();
		expect(repoWithBranch.branch).toBe("master");

		// Step 3: POST /repositories/:id/sessions without workBranch (no worktree)
		const createSessionRes = await app.inject({
			method: "POST",
			url: `/repositories/${repositoryId}/sessions`,
			payload: {
				name: "test-session",
				sourceBranch: "master",
				targetBranch: "master",
			},
		});
		expect(createSessionRes.statusCode).toBe(200);
		const session = createSessionRes.json();
		expect(session.id).toBeTruthy();
		expect(session.name).toBe("test-session");
		expect(session.sourceBranch).toBe("master");
		expect(session.targetBranch).toBe("master");
		expect(session.worktreePath).toBeNull();
		expect(session.state).toBe("idle");
		expect(session.repositoryId).toBe(repositoryId);

		const sessionId = session.id;

		// Step 4: GET /repositories/:id/sessions — verify session exists with correct git context
		const listSessionsRes = await app.inject({
			method: "GET",
			url: `/repositories/${repositoryId}/sessions`,
		});
		expect(listSessionsRes.statusCode).toBe(200);
		const sessions = listSessionsRes.json();
		expect(sessions).toHaveLength(1);
		expect(sessions[0].id).toBe(sessionId);
		expect(sessions[0].sourceBranch).toBe("master");
		expect(sessions[0].targetBranch).toBe("master");

		// Step 5: GET /sessions/:id — verify session details
		const getSessionRes = await app.inject({
			method: "GET",
			url: `/sessions/${sessionId}`,
		});
		expect(getSessionRes.statusCode).toBe(200);
		const sessionDetail = getSessionRes.json();
		expect(sessionDetail.id).toBe(sessionId);
		expect(sessionDetail.name).toBe("test-session");
		expect(sessionDetail.state).toBe("idle");
		expect(sessionDetail.costUsd).toBe(0);
		expect(sessionDetail.inputTokens).toBe(0);
		expect(sessionDetail.outputTokens).toBe(0);

		// Step 6: PATCH /sessions/:id — update name, verify it changed
		const patchRes = await app.inject({
			method: "PATCH",
			url: `/sessions/${sessionId}`,
			payload: { name: "renamed-session" },
		});
		expect(patchRes.statusCode).toBe(200);
		const patched = patchRes.json();
		expect(patched.name).toBe("renamed-session");

		// Verify via GET that the rename persisted
		const verifyRenameRes = await app.inject({
			method: "GET",
			url: `/sessions/${sessionId}`,
		});
		expect(verifyRenameRes.json().name).toBe("renamed-session");

		// Step 7: Create a branch via POST /repositories/:id/git/branch
		const branchName = "feature/integration-test";
		const createBranchRes = await app.inject({
			method: "POST",
			url: `/repositories/${repositoryId}/git/branch`,
			payload: { name: branchName },
		});
		expect(createBranchRes.statusCode).toBe(200);
		expect(createBranchRes.json().branch).toBe(branchName);

		// Verify branch was created
		const branchesRes = await app.inject({
			method: "GET",
			url: `/repositories/${repositoryId}/git/branches`,
		});
		expect(branchesRes.statusCode).toBe(200);
		const branches = branchesRes.json();
		expect(branches.all).toContain(branchName);

		// Step 8: Create a session with workBranch to create a worktree
		const worktreeSessionRes = await app.inject({
			method: "POST",
			url: `/repositories/${repositoryId}/sessions`,
			payload: {
				name: "worktree-session",
				sourceBranch: branchName,
				workBranch: branchName,
				targetBranch: "master",
			},
		});
		expect(worktreeSessionRes.statusCode).toBe(200);
		const worktreeSession = worktreeSessionRes.json();
		expect(worktreeSession.id).toBeTruthy();
		expect(worktreeSession.worktreePath).toBeTruthy();
		expect(worktreeSession.sourceBranch).toBe(branchName);

		const worktreeSessionId = worktreeSession.id;

		// Step 9: Verify worktree was created via GET /repositories/:id/git/worktrees
		const worktreesRes = await app.inject({
			method: "GET",
			url: `/repositories/${repositoryId}/git/worktrees`,
		});
		expect(worktreesRes.statusCode).toBe(200);
		const worktrees = worktreesRes.json();
		// Should have at least 2: the main worktree + the one we created
		expect(worktrees.length).toBeGreaterThanOrEqual(2);
		const createdWorktree = worktrees.find(
			(wt: { path: string; branch: string }) => wt.branch === branchName,
		);
		expect(createdWorktree).toBeTruthy();
		// macOS /var -> /private/var symlink: compare real paths
		expect(realpathSync(createdWorktree.path)).toBe(
			realpathSync(worktreeSession.worktreePath),
		);

		// Step 10: DELETE /sessions/:id — verify worktree is cleaned up
		const deleteWorktreeSessionRes = await app.inject({
			method: "DELETE",
			url: `/sessions/${worktreeSessionId}`,
		});
		expect(deleteWorktreeSessionRes.statusCode).toBe(204);

		// Verify worktree was removed
		const worktreesAfterRes = await app.inject({
			method: "GET",
			url: `/repositories/${repositoryId}/git/worktrees`,
		});
		const worktreesAfter = worktreesAfterRes.json();
		const removedWorktree = worktreesAfter.find(
			(wt: { path: string; branch: string }) => wt.branch === branchName,
		);
		expect(removedWorktree).toBeUndefined();

		// Verify session is gone
		const deletedSessionRes = await app.inject({
			method: "GET",
			url: `/sessions/${worktreeSessionId}`,
		});
		expect(deletedSessionRes.statusCode).toBe(404);

		// Step 11: DELETE /repositories/:id — verify cleanup
		const deleteRepoRes = await app.inject({
			method: "DELETE",
			url: `/repositories/${repositoryId}`,
		});
		expect(deleteRepoRes.statusCode).toBe(204);

		// Verify repository is gone
		const deletedRepoRes = await app.inject({
			method: "GET",
			url: `/repositories/${repositoryId}`,
		});
		expect(deletedRepoRes.statusCode).toBe(404);

		// Verify remaining session (the non-worktree one) is also cleaned up
		const remainingSessionRes = await app.inject({
			method: "GET",
			url: `/sessions/${sessionId}`,
		});
		expect(remainingSessionRes.statusCode).toBe(404);

		// Verify listing repositories returns empty
		const listReposRes = await app.inject({
			method: "GET",
			url: "/repositories",
		});
		expect(listReposRes.json()).toHaveLength(0);
	});
});
