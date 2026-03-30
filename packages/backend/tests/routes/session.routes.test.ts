import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildApp } from "../helpers/build-app";
import { createTestRepo } from "../helpers/test-repo";

let app: Awaited<ReturnType<typeof buildApp>>;
let repoPath: string;
let cleanupRepo: () => void;
let repositoryId: string;

beforeEach(async () => {
	const repo = await createTestRepo();
	repoPath = repo.path;
	cleanupRepo = repo.cleanup;
	app = await buildApp();

	// Create repository
	const repoRes = await app.inject({
		method: "POST",
		url: "/repositories",
		payload: { path: repoPath },
	});
	repositoryId = repoRes.json().id;
});

afterEach(async () => {
	await app.close();
	cleanupRepo();
});

describe("Session routes", () => {
	test("POST creates a session", async () => {
		const res = await app.inject({
			method: "POST",
			url: `/repositories/${repositoryId}/sessions`,
			payload: {
				name: "test",
				sourceBranch: "feat/x",
				targetBranch: "dev",
			},
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().sourceBranch).toBe("feat/x");
	});

	test("GET lists sessions for repository", async () => {
		await app.inject({
			method: "POST",
			url: `/repositories/${repositoryId}/sessions`,
			payload: {
				name: "s1",
				sourceBranch: "a",
				targetBranch: "b",
			},
		});
		const res = await app.inject({
			method: "GET",
			url: `/repositories/${repositoryId}/sessions`,
		});
		expect(res.json()).toHaveLength(1);
	});

	test("GET /sessions/:id returns session", async () => {
		const created = (
			await app.inject({
				method: "POST",
				url: `/repositories/${repositoryId}/sessions`,
				payload: {
					name: "s1",
					sourceBranch: "a",
					targetBranch: "b",
				},
			})
		).json();
		const res = await app.inject({
			method: "GET",
			url: `/sessions/${created.id}`,
		});
		expect(res.json().id).toBe(created.id);
	});

	test("DELETE /sessions/:id destroys session", async () => {
		const created = (
			await app.inject({
				method: "POST",
				url: `/repositories/${repositoryId}/sessions`,
				payload: {
					name: "s1",
					sourceBranch: "a",
					targetBranch: "b",
				},
			})
		).json();
		const res = await app.inject({
			method: "DELETE",
			url: `/sessions/${created.id}`,
		});
		expect(res.statusCode).toBe(204);
	});

	test("PATCH /sessions/:id updates metadata", async () => {
		const created = (
			await app.inject({
				method: "POST",
				url: `/repositories/${repositoryId}/sessions`,
				payload: {
					name: "s1",
					sourceBranch: "a",
					targetBranch: "b",
				},
			})
		).json();
		const res = await app.inject({
			method: "PATCH",
			url: `/sessions/${created.id}`,
			payload: { name: "renamed" },
		});
		expect(res.json().name).toBe("renamed");
	});

	test("DELETE /sessions/:id returns 409 when session has dirty worktree", async () => {
		// Use a unique branch name to avoid worktree path collisions across test runs
		const uniqueSuffix = repositoryId.slice(0, 8);
		const branchName = `feat/dirty-route-${uniqueSuffix}`;

		// Create a branch for worktree
		const { GitService } = await import("../../src/services/git.service");
		const gitService = new GitService();
		await gitService.createBranch(repoPath, branchName);

		// Create session with worktree
		const created = (
			await app.inject({
				method: "POST",
				url: `/repositories/${repositoryId}/sessions`,
				payload: {
					name: "dirty-session",
					sourceBranch: branchName,
					workBranch: branchName,
					targetBranch: "master",
				},
			})
		).json();

		// Make worktree dirty
		const fs = await import("node:fs");
		fs.writeFileSync(`${created.worktreePath}/dirty.txt`, "uncommitted");

		// DELETE without force should return 409
		const res = await app.inject({
			method: "DELETE",
			url: `/sessions/${created.id}`,
		});
		expect(res.statusCode).toBe(409);
		expect(res.json().code).toBe("DIRTY_STATE");

		// DELETE with force should succeed
		const forceRes = await app.inject({
			method: "DELETE",
			url: `/sessions/${created.id}?force=true`,
		});
		expect(forceRes.statusCode).toBe(204);
	});
});
