import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { Store } from "../../src/infra/store";
import { makeRepository, makeSession } from "../helpers/fixtures";

let store: Store;
const DB_PATH = "/tmp/oncraft-test.db";

beforeEach(() => {
	store = new Store(DB_PATH);
});

afterEach(() => {
	store.close();
	for (const suffix of ["", "-wal", "-shm"]) {
		try {
			unlinkSync(DB_PATH + suffix);
		} catch {}
	}
});

describe("Store - Repositories", () => {
	test("creates and retrieves a repository", () => {
		const repo = makeRepository();
		store.createRepository(repo);
		const result = store.getRepository(repo.id);
		expect(result).toEqual(repo);
	});

	test("lists all repositories", () => {
		const repo1 = makeRepository({ name: "repo-a", path: "/tmp/repo-a" });
		const repo2 = makeRepository({ name: "repo-b", path: "/tmp/repo-b" });
		store.createRepository(repo1);
		store.createRepository(repo2);
		const list = store.listRepositories();
		expect(list).toHaveLength(2);
	});

	test("deletes a repository", () => {
		const repo = makeRepository();
		store.createRepository(repo);
		store.deleteRepository(repo.id);
		expect(store.getRepository(repo.id)).toBeNull();
	});

	test("updates lastOpenedAt", () => {
		const repo = makeRepository();
		store.createRepository(repo);
		const newTime = new Date().toISOString();
		store.updateRepositoryLastOpened(repo.id, newTime);
		expect(store.getRepository(repo.id)?.lastOpenedAt).toBe(newTime);
	});
});

describe("Store - Sessions", () => {
	test("creates and retrieves a session", () => {
		const session = makeSession();
		store.createSession(session);
		const result = store.getSession(session.id);
		expect(result).toEqual(session);
	});

	test("lists sessions for a repository", () => {
		const s1 = makeSession({ repositoryId: "repo-1" });
		const s2 = makeSession({ repositoryId: "repo-1" });
		const s3 = makeSession({ repositoryId: "repo-2" });
		store.createSession(s1);
		store.createSession(s2);
		store.createSession(s3);
		expect(store.listSessions("repo-1")).toHaveLength(2);
		expect(store.listSessions("repo-2")).toHaveLength(1);
	});

	test("updates session state", () => {
		const session = makeSession({ state: "idle" });
		store.createSession(session);
		store.updateSessionState(session.id, "active");
		expect(store.getSession(session.id)?.state).toBe("active");
	});

	test("updates session metrics", () => {
		const session = makeSession();
		store.createSession(session);
		store.updateSessionMetrics(session.id, {
			costUsd: 0.05,
			inputTokens: 1000,
			outputTokens: 500,
		});
		const updated = store.getSession(session.id);
		expect(updated?.costUsd).toBe(0.05);
		expect(updated?.inputTokens).toBe(1000);
	});

	test("updates claudeSessionId", () => {
		const session = makeSession();
		store.createSession(session);
		store.updateClaudeSessionId(session.id, "claude-abc-123");
		expect(store.getSession(session.id)?.claudeSessionId).toBe(
			"claude-abc-123",
		);
	});

	test("deletes a session", () => {
		const session = makeSession();
		store.createSession(session);
		store.deleteSession(session.id);
		expect(store.getSession(session.id)).toBeNull();
	});

	test("deletes all sessions for a repository", () => {
		const s1 = makeSession({ repositoryId: "repo-1" });
		const s2 = makeSession({ repositoryId: "repo-1" });
		store.createSession(s1);
		store.createSession(s2);
		store.deleteSessionsForRepository("repo-1");
		expect(store.listSessions("repo-1")).toHaveLength(0);
	});
});

describe("session preferences columns", () => {
	it("defaults preference columns to null for a fresh session", () => {
		const store = new Store(":memory:");
		const repoId = crypto.randomUUID();
		store.createRepository({
			id: repoId,
			path: "/tmp/x",
			name: "x",
			createdAt: new Date().toISOString(),
			lastOpenedAt: new Date().toISOString(),
		});
		const sessionId = crypto.randomUUID();
		store.createSession({
			id: sessionId,
			repositoryId: repoId,
			claudeSessionId: null,
			name: "s",
			sourceBranch: "main",
			workBranch: null,
			targetBranch: "main",
			worktreePath: null,
			state: "idle",
			createdAt: new Date().toISOString(),
			lastActivityAt: new Date().toISOString(),
			costUsd: 0,
			inputTokens: 0,
			outputTokens: 0,
			preferredModel: null,
			preferredEffort: null,
			preferredPermissionMode: null,
			thinkingMode: null,
			thinkingBudget: null,
		});
		const got = store.getSession(sessionId);
		expect(got).not.toBeNull();
		expect(got?.preferredModel).toBeNull();
		expect(got?.preferredEffort).toBeNull();
		expect(got?.preferredPermissionMode).toBeNull();
		expect(got?.thinkingMode).toBeNull();
		expect(got?.thinkingBudget).toBeNull();
	});

	it("persists preference fields via updateSessionPreferences", () => {
		const store = new Store(":memory:");
		const repoId = crypto.randomUUID();
		store.createRepository({
			id: repoId,
			path: "/tmp/y",
			name: "y",
			createdAt: new Date().toISOString(),
			lastOpenedAt: new Date().toISOString(),
		});
		const sessionId = crypto.randomUUID();
		store.createSession({
			id: sessionId,
			repositoryId: repoId,
			claudeSessionId: null,
			name: "s",
			sourceBranch: "main",
			workBranch: null,
			targetBranch: "main",
			worktreePath: null,
			state: "idle",
			createdAt: new Date().toISOString(),
			lastActivityAt: new Date().toISOString(),
			costUsd: 0,
			inputTokens: 0,
			outputTokens: 0,
			preferredModel: null,
			preferredEffort: null,
			preferredPermissionMode: null,
			thinkingMode: null,
			thinkingBudget: null,
		});
		store.updateSessionPreferences(sessionId, {
			preferredModel: "opus",
			preferredEffort: "high",
			preferredPermissionMode: "acceptEdits",
			thinkingMode: "fixed",
			thinkingBudget: 12000,
		});
		const got = store.getSession(sessionId);
		expect(got).not.toBeNull();
		expect(got?.preferredModel).toBe("opus");
		expect(got?.preferredEffort).toBe("high");
		expect(got?.preferredPermissionMode).toBe("acceptEdits");
		expect(got?.thinkingMode).toBe("fixed");
		expect(got?.thinkingBudget).toBe(12000);
	});
});
