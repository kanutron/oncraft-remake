import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "../../src/infra/event-bus";
import { GitWatcher } from "../../src/infra/git-watcher";
import { GitService } from "../../src/services/git.service";
import { createTestRepo } from "../helpers/test-repo";

let eventBus: EventBus;
let gitService: GitService;
let watcher: GitWatcher;
let repoPath: string;
let cleanupRepo: () => void;

beforeEach(async () => {
	const repo = await createTestRepo();
	repoPath = repo.path;
	cleanupRepo = repo.cleanup;
	eventBus = new EventBus();
	gitService = new GitService();
	watcher = new GitWatcher(eventBus, gitService);
});

afterEach(async () => {
	await watcher.unwatchAll();
	cleanupRepo();
});

describe("GitWatcher", () => {
	test("emits repository:git-changed when branch switches", async () => {
		await gitService.createBranch(repoPath, "feat/test");
		const received: unknown[] = [];
		eventBus.on(repoPath, "repository:git-changed", (data) => received.push(data));

		watcher.watch(repoPath);
		// Give watcher time to initialize
		await new Promise((r) => setTimeout(r, 200));

		await gitService.checkout(repoPath, "feat/test");
		// Wait for filesystem event + debounce
		await new Promise((r) => setTimeout(r, 3000));

		expect(received.length).toBeGreaterThanOrEqual(1);
		const event = received[0] as { from: string; to: string };
		expect(event.to).toBe("feat/test");
	});

	test("unwatch stops emitting events", async () => {
		await gitService.createBranch(repoPath, "feat/test");
		const received: unknown[] = [];
		eventBus.on(repoPath, "repository:git-changed", (data) => received.push(data));

		watcher.watch(repoPath);
		await new Promise((r) => setTimeout(r, 200));
		watcher.unwatch(repoPath);

		await gitService.checkout(repoPath, "feat/test");
		await new Promise((r) => setTimeout(r, 1000));

		expect(received).toHaveLength(0);
	});

	test("unwatchAll stops all watchers", async () => {
		const received: unknown[] = [];
		eventBus.on(repoPath, "repository:git-changed", (data) => received.push(data));

		watcher.watch(repoPath);
		await new Promise((r) => setTimeout(r, 200));
		await watcher.unwatchAll();

		await gitService.createBranch(repoPath, "feat/test");
		await gitService.checkout(repoPath, "feat/test");
		await new Promise((r) => setTimeout(r, 1000));

		expect(received).toHaveLength(0);
	});

	test("watch is idempotent — calling twice does not duplicate events", async () => {
		await gitService.createBranch(repoPath, "feat/test");
		const received: unknown[] = [];
		eventBus.on(repoPath, "repository:git-changed", (data) => received.push(data));

		watcher.watch(repoPath);
		watcher.watch(repoPath);
		await new Promise((r) => setTimeout(r, 200));

		await gitService.checkout(repoPath, "feat/test");
		await new Promise((r) => setTimeout(r, 3000));

		// Should receive exactly 1 event, not duplicated
		expect(received.length).toBe(1);
	});
});
