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

describe("Git routes", () => {
	test("GET /repositories/:id/git/status returns git status", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/repositories/${repositoryId}/git/status`,
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body).toHaveProperty("current");
		expect(body).toHaveProperty("files");
		expect(body).toHaveProperty("modified");
	});

	test("GET /repositories/:id/git/status returns 404 for unknown repository", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/repositories/nonexistent-id/git/status",
		});
		expect(res.statusCode).toBe(404);
		expect(res.json().code).toBe("NOT_FOUND");
	});

	test("GET /repositories/:id/git/branches returns branch list", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/repositories/${repositoryId}/git/branches`,
		});
		expect(res.statusCode).toBe(200);
		expect(res.json()).toHaveProperty("all");
	});

	test("POST /repositories/:id/git/branch creates a branch", async () => {
		const res = await app.inject({
			method: "POST",
			url: `/repositories/${repositoryId}/git/branch`,
			payload: { name: "feat/test-branch" },
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().branch).toBe("feat/test-branch");
	});

	test("POST /repositories/:id/git/branch returns 400 for invalid branch", async () => {
		const res = await app.inject({
			method: "POST",
			url: `/repositories/${repositoryId}/git/branch`,
			payload: { name: "feat/test-branch" },
		});
		// Creating the same branch again should fail
		const res2 = await app.inject({
			method: "POST",
			url: `/repositories/${repositoryId}/git/branch`,
			payload: { name: "feat/test-branch" },
		});
		expect(res.statusCode).toBe(200);
		expect(res2.statusCode).toBe(400);
		expect(res2.json().code).toBe("BRANCH_FAILED");
	});

	test("POST /repositories/:id/git/checkout switches branch", async () => {
		// Create branch first
		await app.inject({
			method: "POST",
			url: `/repositories/${repositoryId}/git/branch`,
			payload: { name: "feat/checkout-test" },
		});
		const res = await app.inject({
			method: "POST",
			url: `/repositories/${repositoryId}/git/checkout`,
			payload: { branch: "feat/checkout-test" },
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().branch).toBe("feat/checkout-test");
	});

	test("POST /repositories/:id/git/checkout returns 400 for nonexistent branch", async () => {
		const res = await app.inject({
			method: "POST",
			url: `/repositories/${repositoryId}/git/checkout`,
			payload: { branch: "nonexistent-branch" },
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().code).toBe("CHECKOUT_FAILED");
	});

	test("GET /repositories/:id/git/worktrees returns worktree list", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/repositories/${repositoryId}/git/worktrees`,
		});
		expect(res.statusCode).toBe(200);
		expect(Array.isArray(res.json())).toBe(true);
	});

	test("POST /repositories/:id/git/merge merges a branch", async () => {
		// Create and switch to a feature branch, make a commit, then merge back
		await app.inject({
			method: "POST",
			url: `/repositories/${repositoryId}/git/branch`,
			payload: { name: "feat/merge-source" },
		});
		// We just verify the route exists and returns proper error for no-op merge
		// (merging a branch that's already merged = no-op, which simple-git handles)
		const res = await app.inject({
			method: "POST",
			url: `/repositories/${repositoryId}/git/merge`,
			payload: { source: "feat/merge-source" },
		});
		// Merging a branch with the same HEAD succeeds (already up to date)
		expect(res.statusCode).toBe(200);
	});

	test("POST /repositories/:id/git/merge returns 409 for invalid source", async () => {
		const res = await app.inject({
			method: "POST",
			url: `/repositories/${repositoryId}/git/merge`,
			payload: { source: "nonexistent-branch" },
		});
		expect(res.statusCode).toBe(409);
		expect(res.json().code).toBe("MERGE_CONFLICT");
	});

	test("POST /repositories/:id/git/rebase returns 409 for invalid rebase", async () => {
		const res = await app.inject({
			method: "POST",
			url: `/repositories/${repositoryId}/git/rebase`,
			payload: { branch: "nonexistent", onto: "also-nonexistent" },
		});
		expect(res.statusCode).toBe(409);
		expect(res.json().code).toBe("REBASE_CONFLICT");
	});
});
