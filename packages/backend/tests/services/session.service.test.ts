import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { EventBus } from "../../src/infra/event-bus";
import { Store } from "../../src/infra/store";
import { GitService } from "../../src/services/git.service";
import { ProcessManager } from "../../src/services/process-manager";
import {
	DirtyStateError,
	SessionService,
} from "../../src/services/session.service";
import { makeRepository } from "../helpers/fixtures";
import { createTestRepo } from "../helpers/test-repo";

// ---------------------------------------------------------------------------
// Stub ProcessManager — used only in the preferences describe block below.
// The real ProcessManager spawns a bridge subprocess; this stub records calls.
// ---------------------------------------------------------------------------
class StubProcessManager extends ProcessManager {
	sent: Record<string, unknown>[] = [];

	override async spawn(_sessionId: string, _cwd: string): Promise<void> {}
	override async waitForReady(_sessionId: string): Promise<void> {}
	override isAlive(_sessionId: string): boolean {
		return true;
	}
	override send(_sessionId: string, command: Record<string, unknown>): void {
		this.sent.push(command);
	}
	override async stopAll(): Promise<void> {}
}

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

	// Create a repository first
	const repository = makeRepository({ id: "repo-1", path: repoPath });
	store.createRepository(repository);
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
		const session = await service.create("repo-1", {
			name: "Auth feature",
			sourceBranch: "feat/auth",
			targetBranch: "dev",
		});
		expect(session.repositoryId).toBe("repo-1");
		expect(session.sourceBranch).toBe("feat/auth");
		expect(session.targetBranch).toBe("dev");
		expect(session.state).toBe("idle");
	});

	test("creates a session with worktree", async () => {
		const gitService = new GitService();
		await gitService.createBranch(repoPath, "feat/wt-test");

		const session = await service.create("repo-1", {
			name: "WT session",
			sourceBranch: "feat/wt-test",
			workBranch: "feat/wt-test",
			targetBranch: "main",
		});
		expect(session.worktreePath).toBeTruthy();
		expect(session.state).toBe("idle");

		// Cleanup
		await service.destroy(session.id);
	});

	test("lists sessions for repository", async () => {
		await service.create("repo-1", {
			name: "s1",
			sourceBranch: "a",
			targetBranch: "b",
		});
		await service.create("repo-1", {
			name: "s2",
			sourceBranch: "c",
			targetBranch: "d",
		});
		const sessions = service.list("repo-1");
		expect(sessions).toHaveLength(2);
	});

	test("emits worktree conflict warning when two sessions on same worktree become active", async () => {
		const s1 = await service.create("repo-1", {
			name: "s1",
			sourceBranch: "a",
			targetBranch: "b",
		});
		const s2 = await service.create("repo-1", {
			name: "s2",
			sourceBranch: "c",
			targetBranch: "d",
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
		const session = await service.create("repo-1", {
			name: "s1",
			sourceBranch: "a",
			targetBranch: "b",
		});
		await service.destroy(session.id);
		expect(service.get(session.id)).toBeNull();
	});

	test("emits session:created event on create", async () => {
		const events: unknown[] = [];
		eventBus.on("*", "session:created", (data) => events.push(data));

		const session = await service.create("repo-1", {
			name: "test",
			sourceBranch: "feat/x",
			targetBranch: "dev",
		});

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			sessionId: session.id,
			repositoryId: "repo-1",
			name: "test",
		});
	});

	test("emits session:deleted event on destroy", async () => {
		const session = await service.create("repo-1", {
			name: "to-delete",
			sourceBranch: "feat/x",
			targetBranch: "dev",
		});

		const events: unknown[] = [];
		eventBus.on("*", "session:deleted", (data) => events.push(data));

		await service.destroy(session.id);

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			sessionId: session.id,
			repositoryId: "repo-1",
			name: "to-delete",
		});
	});

	test("destroy throws on dirty worktree unless force is true", async () => {
		const gitService = new GitService();
		await gitService.createBranch(repoPath, "feat/dirty-test");

		const session = await service.create("repo-1", {
			name: "dirty",
			sourceBranch: "feat/dirty-test",
			workBranch: "feat/dirty-test",
			targetBranch: "master",
		});

		// Make the worktree dirty — create an untracked file
		const fs = await import("node:fs");
		fs.writeFileSync(`${session.worktreePath}/dirty.txt`, "uncommitted work");

		// Should throw a DirtyStateError without force
		await expect(service.destroy(session.id)).rejects.toThrow(DirtyStateError);
		await expect(service.destroy(session.id)).rejects.toThrow(
			"has uncommitted changes",
		);

		// Session should still exist
		expect(service.get(session.id)).not.toBeNull();

		// Should succeed with force
		await service.destroy(session.id, { force: true });
		expect(service.get(session.id)).toBeNull();
	});

	test("destroy throws when work branch has unmerged commits unless force", async () => {
		const gitService = new GitService();
		await gitService.createBranch(repoPath, "feat/unmerged-test");

		const session = await service.create("repo-1", {
			name: "unmerged",
			sourceBranch: "feat/unmerged-test",
			workBranch: "feat/unmerged-test",
			targetBranch: "master",
		});

		// Add a commit to the work branch
		const fs = await import("node:fs");
		const path = await import("node:path");
		const wtPath = session.worktreePath as string;
		fs.writeFileSync(path.join(wtPath, "new-file.txt"), "content");
		const simpleGit = (await import("simple-git")).default;
		const git = simpleGit(wtPath);
		await git.add("new-file.txt");
		await git.commit("add new file");

		// Should throw a DirtyStateError without force
		await expect(service.destroy(session.id)).rejects.toThrow(DirtyStateError);
		await expect(service.destroy(session.id)).rejects.toThrow(
			"unmerged commits",
		);

		// Should succeed with force
		await service.destroy(session.id, { force: true });
		expect(service.get(session.id)).toBeNull();
	});

	test("destroy succeeds without checks for sessions with no worktree", async () => {
		const session = await service.create("repo-1", {
			name: "no-wt",
			sourceBranch: "feat/x",
			targetBranch: "dev",
		});

		// Should succeed — no worktree means no dirty-state check
		await service.destroy(session.id);
		expect(service.get(session.id)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// send() — preferences roundtrip tests
// Uses StubProcessManager to avoid spawning a real bridge subprocess.
// ---------------------------------------------------------------------------

const PREFS_DB_PATH = "/tmp/oncraft-session-prefs-test.db";

describe("send() — preferences", () => {
	function makeFixture() {
		const store = new Store(PREFS_DB_PATH);
		const eventBus = new EventBus();
		const gitService = new GitService();
		const processManager = new StubProcessManager(eventBus);
		const service = new SessionService(
			store,
			eventBus,
			gitService,
			processManager,
		);

		const repoId = "repo-prefs-1";
		store.createRepository(
			makeRepository({ id: repoId, path: "/tmp/prefs-fake-repo" }),
		);

		return { service, store, processManager, repoId };
	}

	afterEach(() => {
		for (const suffix of ["", "-wal", "-shm"]) {
			try {
				unlinkSync(`${PREFS_DB_PATH}${suffix}`);
			} catch {}
		}
	});

	test("persists prefs in body before forwarding to the bridge", async () => {
		const { service, store, processManager, repoId } = makeFixture();
		const session = await service.create(repoId, {
			name: "t",
			sourceBranch: "main",
		});
		await service.send(session.id, "hi", {
			model: "opus",
			effort: "xhigh",
			permissionMode: "plan",
			thinkingMode: "fixed",
			thinkingBudget: 12000,
		});
		const stored = store.getSession(session.id);
		expect(stored?.preferredModel).toBe("opus");
		expect(stored?.preferredEffort).toBe("xhigh");
		expect(stored?.preferredPermissionMode).toBe("plan");
		expect(stored?.thinkingMode).toBe("fixed");
		expect(stored?.thinkingBudget).toBe(12000);
		const last = processManager.sent.at(-1);
		expect(last).toMatchObject({
			cmd: "start",
			model: "opus",
			effort: "xhigh",
			permissionMode: "plan",
			thinkingMode: "fixed",
			thinkingBudget: 12000,
		});
	});

	test("falls back to stored prefs when body is empty", async () => {
		const { service, store, processManager, repoId } = makeFixture();
		const session = await service.create(repoId, {
			name: "t",
			sourceBranch: "main",
		});
		store.updateSessionPreferences(session.id, {
			preferredModel: "haiku",
			preferredEffort: "low",
		});
		await service.send(session.id, "hi", {});
		const last = processManager.sent.at(-1);
		expect(last).toMatchObject({ model: "haiku", effort: "low" });
	});
});
