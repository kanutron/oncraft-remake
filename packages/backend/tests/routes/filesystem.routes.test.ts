import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../helpers/build-app";

let app: Awaited<ReturnType<typeof buildApp>>;
let testRoot: string;

beforeEach(async () => {
	testRoot = mkdtempSync(join(tmpdir(), "oncraft-fs-route-test-"));
	mkdirSync(join(testRoot, "my-repo", ".git"), { recursive: true });
	mkdirSync(join(testRoot, "plain-dir"));
	writeFileSync(join(testRoot, "file.txt"), "hello");
	app = await buildApp({ fsRoot: testRoot });
});

afterEach(async () => {
	await app.close();
	rmSync(testRoot, { recursive: true, force: true });
});

describe("Filesystem routes", () => {
	test("GET /filesystem/list-dirs returns directory entries", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/filesystem/list-dirs",
			query: { path: testRoot },
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.entries).toHaveLength(2);
		expect(body.entries[0].name).toBe("my-repo");
		expect(body.entries[0].isGitRepo).toBe(true);
		expect(body.entries[1].name).toBe("plain-dir");
		expect(body.entries[1].isGitRepo).toBe(false);
	});

	test("GET /filesystem/list-dirs returns parent", async () => {
		const sub = join(testRoot, "plain-dir");
		const res = await app.inject({
			method: "GET",
			url: "/filesystem/list-dirs",
			query: { path: sub },
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().parent).toBe(testRoot);
	});

	test("GET /filesystem/list-dirs returns 403 for path outside root", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/filesystem/list-dirs",
			query: { path: "/etc" },
		});
		expect(res.statusCode).toBe(403);
		expect(res.json().code).toBe("FORBIDDEN");
	});

	test("GET /filesystem/list-dirs returns 404 for nonexistent path", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/filesystem/list-dirs",
			query: { path: join(testRoot, "nope") },
		});
		expect(res.statusCode).toBe(404);
		expect(res.json().code).toBe("NOT_FOUND");
	});

	test("GET /filesystem/root returns the resolved root path", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/filesystem/root",
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().root).toBe(testRoot);
	});

	test("GET /filesystem/list-dirs returns 400 when path query is missing", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/filesystem/list-dirs",
		});
		expect(res.statusCode).toBe(400);
	});
});
