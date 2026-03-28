import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { EventBus } from "../../src/infra/event-bus";
import { GitWatcher } from "../../src/infra/git-watcher";
import { Store } from "../../src/infra/store";
import { GitService } from "../../src/services/git.service";
import { WorkspaceService } from "../../src/services/workspace.service";
import { createTestRepo } from "../helpers/test-repo";

const DB_PATH = "/tmp/oncraft-ws-test.db";
let service: WorkspaceService;
let store: Store;
let repoPath: string;
let cleanupRepo: () => void;

beforeEach(async () => {
	const repo = await createTestRepo();
	repoPath = repo.path;
	cleanupRepo = repo.cleanup;
	store = new Store(DB_PATH);
	const eventBus = new EventBus();
	const gitService = new GitService();
	const gitWatcher = new GitWatcher(eventBus, gitService);
	service = new WorkspaceService(store, gitService, gitWatcher);
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

describe("WorkspaceService", () => {
	test("opens a git repo as workspace", async () => {
		const ws = await service.open(repoPath);
		expect(ws.path).toBe(repoPath);
		expect(ws.name).toBeTruthy();
	});

	test("rejects non-git directories", async () => {
		await expect(service.open("/tmp")).rejects.toThrow();
	});

	test("returns existing workspace if path already open", async () => {
		const ws1 = await service.open(repoPath);
		const ws2 = await service.open(repoPath);
		expect(ws1.id).toBe(ws2.id);
	});

	test("lists open workspaces", async () => {
		await service.open(repoPath);
		const list = await service.list();
		expect(list).toHaveLength(1);
	});

	test("get includes live branch", async () => {
		const ws = await service.open(repoPath);
		const full = await service.get(ws.id);
		expect(full).toBeTruthy();
		expect(full?.branch).toBeTruthy();
	});

	test("close removes workspace", async () => {
		const ws = await service.open(repoPath);
		await service.close(ws.id);
		expect(await service.get(ws.id)).toBeNull();
	});
});
