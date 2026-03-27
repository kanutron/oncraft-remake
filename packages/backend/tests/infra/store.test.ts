import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { Store } from "../../src/infra/store";
import { makeSession, makeWorkspace } from "../helpers/fixtures";

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

describe("Store - Workspaces", () => {
	test("creates and retrieves a workspace", () => {
		const ws = makeWorkspace();
		store.createWorkspace(ws);
		const result = store.getWorkspace(ws.id);
		expect(result).toEqual(ws);
	});

	test("lists all workspaces", () => {
		const ws1 = makeWorkspace({ name: "repo-a", path: "/tmp/repo-a" });
		const ws2 = makeWorkspace({ name: "repo-b", path: "/tmp/repo-b" });
		store.createWorkspace(ws1);
		store.createWorkspace(ws2);
		const list = store.listWorkspaces();
		expect(list).toHaveLength(2);
	});

	test("deletes a workspace", () => {
		const ws = makeWorkspace();
		store.createWorkspace(ws);
		store.deleteWorkspace(ws.id);
		expect(store.getWorkspace(ws.id)).toBeNull();
	});

	test("updates lastOpenedAt", () => {
		const ws = makeWorkspace();
		store.createWorkspace(ws);
		const newTime = new Date().toISOString();
		store.updateWorkspaceLastOpened(ws.id, newTime);
		expect(store.getWorkspace(ws.id)?.lastOpenedAt).toBe(newTime);
	});
});

describe("Store - Sessions", () => {
	test("creates and retrieves a session", () => {
		const session = makeSession();
		store.createSession(session);
		const result = store.getSession(session.id);
		expect(result).toEqual(session);
	});

	test("lists sessions for a workspace", () => {
		const s1 = makeSession({ workspaceId: "ws-1" });
		const s2 = makeSession({ workspaceId: "ws-1" });
		const s3 = makeSession({ workspaceId: "ws-2" });
		store.createSession(s1);
		store.createSession(s2);
		store.createSession(s3);
		expect(store.listSessions("ws-1")).toHaveLength(2);
		expect(store.listSessions("ws-2")).toHaveLength(1);
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

	test("deletes all sessions for a workspace", () => {
		const s1 = makeSession({ workspaceId: "ws-1" });
		const s2 = makeSession({ workspaceId: "ws-1" });
		store.createSession(s1);
		store.createSession(s2);
		store.deleteSessionsForWorkspace("ws-1");
		expect(store.listSessions("ws-1")).toHaveLength(0);
	});
});
