import type { Session, Workspace } from "../../src/types";

export function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
	return {
		id: crypto.randomUUID(),
		path: "/tmp/test-repo",
		name: "test-repo",
		createdAt: new Date().toISOString(),
		lastOpenedAt: new Date().toISOString(),
		...overrides,
	};
}

export function makeSession(overrides: Partial<Session> = {}): Session {
	return {
		id: crypto.randomUUID(),
		workspaceId: "ws-1",
		claudeSessionId: null,
		name: "test-session",
		sourceBranch: "feat/test",
		targetBranch: "dev",
		worktreePath: null,
		state: "idle",
		createdAt: new Date().toISOString(),
		lastActivityAt: new Date().toISOString(),
		costUsd: 0,
		inputTokens: 0,
		outputTokens: 0,
		...overrides,
	};
}
