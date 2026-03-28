import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { EventBus } from "../../src/infra/event-bus";
import { Store } from "../../src/infra/store";
import { GitService } from "../../src/services/git.service";
import { ProcessManager } from "../../src/services/process-manager";
import { SessionService } from "../../src/services/session.service";
import { makeWorkspace } from "../helpers/fixtures";
import { createTestRepo } from "../helpers/test-repo";

const DB_PATH = "/tmp/oncraft-session-test.db";
let service: SessionService;
let store: Store;
let eventBus: EventBus;
let processManager: ProcessManager;
let repoPath: string;
let cleanupRepo: () => void;

beforeEach(async () => {
	const repo = await createTestRepo();
	repoPath = repo.path;
	cleanupRepo = repo.cleanup;
	store = new Store(DB_PATH);
	eventBus = new EventBus();
	const gitService = new GitService();
	processManager = new ProcessManager(eventBus);
	service = new SessionService(store, eventBus, gitService, processManager);

	// Create a workspace first
	const ws = makeWorkspace({ id: "ws-1", path: repoPath });
	store.createWorkspace(ws);
});

afterEach(async () => {
	await processManager.stopAll();
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

describe("SessionService", () => {
	test("creates a session with git context", async () => {
		const session = await service.create("ws-1", {
			name: "Auth feature",
			sourceBranch: "feat/auth",
			targetBranch: "dev",
			useWorktree: false,
		});
		expect(session.workspaceId).toBe("ws-1");
		expect(session.sourceBranch).toBe("feat/auth");
		expect(session.targetBranch).toBe("dev");
		expect(session.state).toBe("idle");
	});

	test("creates a session with worktree", async () => {
		const gitService = new GitService();
		await gitService.createBranch(repoPath, "feat/wt-test");

		const session = await service.create("ws-1", {
			name: "WT session",
			sourceBranch: "feat/wt-test",
			targetBranch: "main",
			useWorktree: true,
		});
		expect(session.worktreePath).toBeTruthy();
		expect(session.state).toBe("idle");

		// Cleanup
		await service.destroy(session.id);
	});

	test("lists sessions for workspace", async () => {
		await service.create("ws-1", {
			name: "s1",
			sourceBranch: "a",
			targetBranch: "b",
			useWorktree: false,
		});
		await service.create("ws-1", {
			name: "s2",
			sourceBranch: "c",
			targetBranch: "d",
			useWorktree: false,
		});
		const sessions = service.list("ws-1");
		expect(sessions).toHaveLength(2);
	});

	test("emits worktree conflict warning when two sessions on same worktree become active", async () => {
		const s1 = await service.create("ws-1", {
			name: "s1",
			sourceBranch: "a",
			targetBranch: "b",
			useWorktree: false,
		});
		const s2 = await service.create("ws-1", {
			name: "s2",
			sourceBranch: "c",
			targetBranch: "d",
			useWorktree: false,
		});

		const warnings: unknown[] = [];
		eventBus.on("*", "session:worktree-conflict", (data) =>
			warnings.push(data),
		);

		// Simulate both becoming active
		store.updateSessionState(s1.id, "active");
		service.checkWorktreeConflict(s2.id, "active");

		expect(warnings).toHaveLength(1);
	});

	test("destroy cleans up session", async () => {
		const session = await service.create("ws-1", {
			name: "s1",
			sourceBranch: "a",
			targetBranch: "b",
			useWorktree: false,
		});
		await service.destroy(session.id);
		expect(service.get(session.id)).toBeNull();
	});
});
