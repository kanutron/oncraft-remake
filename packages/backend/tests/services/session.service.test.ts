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
