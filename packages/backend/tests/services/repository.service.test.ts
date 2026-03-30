import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { EventBus } from "../../src/infra/event-bus";
import { GitWatcher } from "../../src/infra/git-watcher";
import { Store } from "../../src/infra/store";
import { GitService } from "../../src/services/git.service";
import { RepositoryService } from "../../src/services/repository.service";
import { createTestRepo } from "../helpers/test-repo";

const DB_PATH = "/tmp/oncraft-repo-test.db";
let service: RepositoryService;
let store: Store;
let eventBus: EventBus;
let repoPath: string;
let cleanupRepo: () => void;

beforeEach(async () => {
	const repo = await createTestRepo();
	repoPath = repo.path;
	cleanupRepo = repo.cleanup;
	store = new Store(DB_PATH);
	eventBus = new EventBus();
	const gitService = new GitService();
	const gitWatcher = new GitWatcher(eventBus, gitService);
	service = new RepositoryService(store, gitService, gitWatcher, eventBus);
});

afterEach(async () => {
	await service.closeAll();
	store.close();
	cleanupRepo();
	try {
		unlinkSync(DB_PATH);
	} catch {}
	try {
		unlinkSync(`${DB_PATH}-wal`);
	} catch {}
	try {
		unlinkSync(`${DB_PATH}-shm`);
	} catch {}
});

describe("RepositoryService", () => {
	test("opens a git repo as repository", async () => {
		const repo = await service.open(repoPath);
		expect(repo.path).toBe(repoPath);
		expect(repo.name).toBeTruthy();
	});

	test("rejects non-git directories", async () => {
		await expect(service.open("/tmp")).rejects.toThrow();
	});

	test("returns existing repository if path already open", async () => {
		const repo1 = await service.open(repoPath);
		const repo2 = await service.open(repoPath);
		expect(repo1.id).toBe(repo2.id);
	});

	test("lists open repositories", async () => {
		await service.open(repoPath);
		const list = await service.list();
		expect(list).toHaveLength(1);
	});

	test("get includes live branch", async () => {
		const repo = await service.open(repoPath);
		const full = await service.get(repo.id);
		expect(full).toBeTruthy();
		expect(full?.branch).toBeTruthy();
	});

	test("close removes repository", async () => {
		const repo = await service.open(repoPath);
		await service.close(repo.id);
		expect(await service.get(repo.id)).toBeNull();
	});

	test("emits repository:opened event on open", async () => {
		const events: unknown[] = [];
		eventBus.on("*", "repository:opened", (data) => events.push(data));

		const repo = await service.open(repoPath);

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			repositoryId: repo.id,
			path: repoPath,
			name: repo.name,
		});
	});

	test("does not emit repository:opened for already-open repo", async () => {
		await service.open(repoPath);
		const events: unknown[] = [];
		eventBus.on("*", "repository:opened", (data) => events.push(data));

		await service.open(repoPath);

		expect(events).toHaveLength(0);
	});

	test("emits repository:closed event on close", async () => {
		const repo = await service.open(repoPath);
		const events: unknown[] = [];
		eventBus.on("*", "repository:closed", (data) => events.push(data));

		await service.close(repo.id);

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			repositoryId: repo.id,
			path: repoPath,
			name: repo.name,
		});
	});
});
