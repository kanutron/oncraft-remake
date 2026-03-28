import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildApp } from "../helpers/build-app";
import { createTestRepo } from "../helpers/test-repo";

let app: Awaited<ReturnType<typeof buildApp>>;
let repoPath: string;
let cleanupRepo: () => void;
let workspaceId: string;

beforeEach(async () => {
	const repo = await createTestRepo();
	repoPath = repo.path;
	cleanupRepo = repo.cleanup;
	app = await buildApp();

	// Create workspace
	const wsRes = await app.inject({
		method: "POST",
		url: "/workspaces",
		payload: { path: repoPath },
	});
	workspaceId = wsRes.json().id;
});

afterEach(async () => {
	await app.close();
	cleanupRepo();
});

describe("Session routes", () => {
	test("POST creates a session", async () => {
		const res = await app.inject({
			method: "POST",
			url: `/workspaces/${workspaceId}/sessions`,
			payload: {
				name: "test",
				sourceBranch: "feat/x",
				targetBranch: "dev",
				useWorktree: false,
			},
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().sourceBranch).toBe("feat/x");
	});

	test("GET lists sessions for workspace", async () => {
		await app.inject({
			method: "POST",
			url: `/workspaces/${workspaceId}/sessions`,
			payload: {
				name: "s1",
				sourceBranch: "a",
				targetBranch: "b",
				useWorktree: false,
			},
		});
		const res = await app.inject({
			method: "GET",
			url: `/workspaces/${workspaceId}/sessions`,
		});
		expect(res.json()).toHaveLength(1);
	});

	test("GET /sessions/:id returns session", async () => {
		const created = (
			await app.inject({
				method: "POST",
				url: `/workspaces/${workspaceId}/sessions`,
				payload: {
					name: "s1",
					sourceBranch: "a",
					targetBranch: "b",
					useWorktree: false,
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
				url: `/workspaces/${workspaceId}/sessions`,
				payload: {
					name: "s1",
					sourceBranch: "a",
					targetBranch: "b",
					useWorktree: false,
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
				url: `/workspaces/${workspaceId}/sessions`,
				payload: {
					name: "s1",
					sourceBranch: "a",
					targetBranch: "b",
					useWorktree: false,
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
});
