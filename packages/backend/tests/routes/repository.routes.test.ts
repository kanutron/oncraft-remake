import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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

describe("Repository routes", () => {
	test("POST /repositories opens a repo", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/repositories",
			payload: { path: repoPath },
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.path).toBe(repoPath);
		expect(body.id).toBeTruthy();
	});

	test("POST /repositories rejects non-git path", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/repositories",
			payload: { path: "/tmp" },
		});
		expect(res.statusCode).toBe(400);
	});

	test("GET /repositories lists all", async () => {
		await app.inject({
			method: "POST",
			url: "/repositories",
			payload: { path: repoPath },
		});
		const res = await app.inject({ method: "GET", url: "/repositories" });
		expect(res.json()).toHaveLength(1);
	});

	test("GET /repositories/:id includes branch", async () => {
		const created = (
			await app.inject({
				method: "POST",
				url: "/repositories",
				payload: { path: repoPath },
			})
		).json();
		const res = await app.inject({
			method: "GET",
			url: `/repositories/${created.id}`,
		});
		expect(res.json().branch).toBeTruthy();
	});

	test("DELETE /repositories/:id removes repository", async () => {
		const created = (
			await app.inject({
				method: "POST",
				url: "/repositories",
				payload: { path: repoPath },
			})
		).json();
		const res = await app.inject({
			method: "DELETE",
			url: `/repositories/${created.id}`,
		});
		expect(res.statusCode).toBe(204);
	});
});
