import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemService } from "../../src/services/filesystem.service";

let service: FilesystemService;
let testRoot: string;

beforeEach(() => {
	testRoot = mkdtempSync(join(tmpdir(), "oncraft-fs-test-"));
	service = new FilesystemService(testRoot);

	// Create directory structure:
	// testRoot/
	//   project-a/          (git repo)
	//     .git/
	//   project-b/          (plain dir)
	//   .hidden/            (hidden dir)
	//   file.txt            (file, should be excluded)
	mkdirSync(join(testRoot, "project-a", ".git"), { recursive: true });
	mkdirSync(join(testRoot, "project-b"));
	mkdirSync(join(testRoot, ".hidden"));
	writeFileSync(join(testRoot, "file.txt"), "hello");
});

afterEach(() => {
	rmSync(testRoot, { recursive: true, force: true });
});

describe("FilesystemService", () => {
	test("listDirs returns only directories, sorted alphabetically", async () => {
		const result = await service.listDirs(testRoot);
		const names = result.entries.map((e) => e.name);
		expect(names).toEqual(["project-a", "project-b"]);
	});

	test("listDirs excludes hidden directories", async () => {
		const result = await service.listDirs(testRoot);
		const names = result.entries.map((e) => e.name);
		expect(names).not.toContain(".hidden");
	});

	test("listDirs excludes files", async () => {
		const result = await service.listDirs(testRoot);
		const names = result.entries.map((e) => e.name);
		expect(names).not.toContain("file.txt");
	});

	test("listDirs detects git repos", async () => {
		const result = await service.listDirs(testRoot);
		const projectA = result.entries.find((e) => e.name === "project-a");
		const projectB = result.entries.find((e) => e.name === "project-b");
		expect(projectA?.isGitRepo).toBe(true);
		expect(projectB?.isGitRepo).toBe(false);
	});

	test("listDirs returns absolute paths", async () => {
		const result = await service.listDirs(testRoot);
		for (const entry of result.entries) {
			expect(entry.path.startsWith("/")).toBe(true);
		}
	});

	test("listDirs returns parent path", async () => {
		const sub = join(testRoot, "project-b");
		mkdirSync(join(sub, "child"));
		const result = await service.listDirs(sub);
		expect(result.parent).toBe(testRoot);
	});

	test("listDirs returns null parent at root boundary", async () => {
		const result = await service.listDirs(testRoot);
		// Parent of testRoot is outside testRoot, so it should be null
		expect(result.parent).toBeNull();
	});

	test("listDirs rejects paths outside root", async () => {
		expect(service.listDirs("/etc")).rejects.toThrow("FORBIDDEN");
	});

	test("listDirs rejects nonexistent paths", async () => {
		expect(service.listDirs(join(testRoot, "nonexistent"))).rejects.toThrow(
			"NOT_FOUND",
		);
	});
});
