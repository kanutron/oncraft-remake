export interface Project {
	id: string;
	name: string;
	createdAt: string;
	lastOpenedAt: string;
}

export interface Repository {
	id: string;
	path: string;
	name: string;
	createdAt: string;
	lastOpenedAt: string;
}

export interface Session {
	id: string;
	repositoryId: string;
	claudeSessionId: string | null;
	name: string;
	sourceBranch: string;
	workBranch: string | null;
	targetBranch: string;
	worktreePath: string | null;
	state: SessionState;
	createdAt: string;
	lastActivityAt: string;
	costUsd: number;
	inputTokens: number;
	outputTokens: number;
	preferredModel: string | null;
	preferredEffort: string | null;
	preferredPermissionMode: string | null;
	thinkingMode: "off" | "adaptive" | "fixed" | null;
	thinkingBudget: number | null;
}

export type SessionState =
	| "idle"
	| "starting"
	| "active"
	| "stopped"
	| "error"
	| "completed";

// Bridge stdin commands
export interface BridgeCommand {
	cmd:
		| "start"
		| "reply"
		| "interrupt"
		| "stop"
		| "loadHistory"
		| "loadSubagents"
		| "listSessions";
	[key: string]: unknown;
}

// Bridge stdout events — raw SDK messages pass through, bridge adds its own types
export interface BridgeEvent {
	type: string;
	[key: string]: unknown;
}

// WebSocket server -> client events
export interface WSServerEvent {
	event: string;
	sessionId?: string;
	repositoryId?: string;
	data: unknown;
}

// WebSocket client -> server commands
export interface WSClientCommand {
	command: string;
	sessionId?: string;
	data: unknown;
}

// Git state change event (emitted by GitWatcher, path-scoped)
export interface GitChangeEvent {
	path: string;
	from: string;
	to: string;
}
