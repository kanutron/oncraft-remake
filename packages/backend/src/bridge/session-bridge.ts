/**
 * Session Bridge — Standalone Bun script that bridges stdin/stdout to the Claude Agent SDK.
 *
 * Spawned as a child process by ProcessManager.
 * Receives JSON-line commands on stdin, emits JSON-line events on stdout.
 */

import { createInterface } from "node:readline";

// --- Types ---

interface StartCommand {
	cmd: "start";
	projectPath: string;
	prompt: string;
	sessionId?: string;
	model?: string;
	effort?: string;
	permissionMode?: string;
}

interface ReplyCommand {
	cmd: "reply";
	toolUseID: string;
	decision: "allow" | "deny";
}

interface InterruptCommand {
	cmd: "interrupt";
}

interface StopCommand {
	cmd: "stop";
}

interface LoadHistoryCommand {
	cmd: "loadHistory";
	sessionId: string;
}

interface LoadSubagentsCommand {
	cmd: "loadSubagents";
	sessionId: string;
}

type BridgeCommand =
	| StartCommand
	| ReplyCommand
	| InterruptCommand
	| StopCommand
	| LoadHistoryCommand
	| LoadSubagentsCommand;

// --- State ---

let activeAbort: AbortController | null = null;
const pendingApprovals = new Map<
	string,
	(result: { behavior: "allow" | "deny" }) => void
>();

// --- Helpers ---

function emit(event: Record<string, unknown>): void {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}

// --- Message Stream ---

/**
 * AsyncIterable that feeds user messages into the SDK's query loop.
 * New messages are enqueued here; the SDK consumes them as they arrive.
 */
interface SDKUserMessage {
	type: "user";
	message: { role: "user"; content: string };
	parent_tool_use_id: string | null;
}

class MessageStream implements AsyncIterable<SDKUserMessage> {
	private queue: SDKUserMessage[] = [];
	private resolve: (() => void) | null = null;
	private done = false;

	enqueue(message: string): void {
		this.queue.push({
			type: "user",
			message: { role: "user", content: message },
			parent_tool_use_id: null,
		});
		this.resolve?.();
		this.resolve = null;
	}

	end(): void {
		this.done = true;
		this.resolve?.();
		this.resolve = null;
	}

	[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
		return {
			next: async () => {
				while (this.queue.length === 0 && !this.done) {
					await new Promise<void>((r) => {
						this.resolve = r;
					});
				}
				const value = this.queue.shift();
				if (value !== undefined) {
					return { value, done: false };
				}
				return { value: undefined as never, done: true };
			},
		};
	}
}

let activeStream: MessageStream | null = null;

// --- Command Handlers ---

async function handleStart(cmd: StartCommand): Promise<void> {
	// If there's already an active stream, enqueue the message as a follow-up
	if (activeStream) {
		activeStream.enqueue(cmd.prompt);
		return;
	}

	// Dynamic import to avoid loading SDK at module level
	const sdk = await import("@anthropic-ai/claude-agent-sdk");

	activeStream = new MessageStream();
	activeStream.enqueue(cmd.prompt);
	activeAbort = new AbortController();

	const options: Record<string, unknown> = {
		cwd: cmd.projectPath,
		abortController: activeAbort,
		settingSources: ["user", "project", "local"],
		model: cmd.model,
		permissionMode: cmd.permissionMode,
		canUseTool: async (
			toolName: string,
			toolInput: unknown,
			toolOptions: {
				toolUseID: string;
				agentID?: string;
				decisionReason?: string;
			},
		) => {
			const toolUseID = toolOptions.toolUseID;
			emit({
				type: "tool_confirmation",
				toolUseID,
				toolName,
				toolInput,
				agentID: toolOptions.agentID,
				decisionReason: toolOptions.decisionReason,
			});
			return new Promise<{ behavior: "allow" | "deny" }>((resolve) => {
				pendingApprovals.set(toolUseID, resolve);
			});
		},
	};

	if (cmd.sessionId) {
		options.resume = cmd.sessionId;
	}

	try {
		const result = sdk.query({
			prompt: activeStream,
			options,
		});

		for await (const message of result) {
			emit(message as Record<string, unknown>);
		}
	} catch (err) {
		if ((err as Error).name !== "AbortError") {
			emit({ type: "bridge:error", message: String(err) });
		}
	} finally {
		activeStream = null;
		activeAbort = null;
	}
}

function handleReply(cmd: ReplyCommand): void {
	const resolve = pendingApprovals.get(cmd.toolUseID);
	if (resolve) {
		resolve({ behavior: cmd.decision });
		pendingApprovals.delete(cmd.toolUseID);
	}
}

function handleInterrupt(): void {
	if (activeAbort) {
		activeAbort.abort();
	}
	if (activeStream) {
		activeStream.end();
	}
}

async function handleLoadHistory(cmd: LoadHistoryCommand): Promise<void> {
	try {
		const sdk = await import("@anthropic-ai/claude-agent-sdk");
		const messages = await sdk.getSessionMessages(cmd.sessionId);
		emit({ type: "bridge:history", messages });
	} catch (err) {
		emit({
			type: "bridge:error",
			message: `Failed to load history: ${err}`,
		});
	}
}

async function handleLoadSubagents(cmd: LoadSubagentsCommand): Promise<void> {
	try {
		const sdk = await import("@anthropic-ai/claude-agent-sdk");
		const { readFile } = await import("node:fs/promises");
		const { homedir } = await import("node:os");
		const { join } = await import("node:path");
		const { existsSync } = await import("node:fs");

		const agentIds = await sdk.listSubagents(cmd.sessionId);
		const projectsDir = join(homedir(), ".claude", "projects");
		const { readdir } = await import("node:fs/promises");
		const projects = await readdir(projectsDir);
		let subagentsDir: string | null = null;
		for (const project of projects) {
			const candidate = join(projectsDir, project, cmd.sessionId, "subagents");
			if (existsSync(candidate)) {
				subagentsDir = candidate;
				break;
			}
		}

		const entries: Array<{
			agentId: string;
			agentType?: string;
			description?: string;
			messages: unknown[];
		}> = [];
		for (const agentId of agentIds) {
			let agentType: string | undefined;
			let description: string | undefined;
			if (subagentsDir) {
				try {
					const metaPath = join(subagentsDir, `agent-${agentId}.meta.json`);
					const raw = await readFile(metaPath, "utf8");
					const meta = JSON.parse(raw) as {
						agentType?: string;
						description?: string;
					};
					agentType = meta.agentType;
					description = meta.description;
				} catch {
					/* missing or unreadable meta.json — skip, still correlate by id */
				}
			}
			const messages = await sdk.getSubagentMessages(cmd.sessionId, agentId);
			entries.push({ agentId, agentType, description, messages });
		}

		emit({ type: "bridge:subagents", entries });
	} catch (err) {
		emit({
			type: "bridge:error",
			message: `Failed to load subagents: ${err}`,
		});
	}
}

// --- Main Loop ---

emit({ type: "bridge:ready" });

const rl = createInterface({ input: process.stdin });

rl.on("line", async (line) => {
	try {
		const cmd = JSON.parse(line) as BridgeCommand;

		switch (cmd.cmd) {
			case "start":
				handleStart(cmd);
				break;
			case "reply":
				handleReply(cmd);
				break;
			case "interrupt":
				handleInterrupt();
				break;
			case "loadHistory":
				await handleLoadHistory(cmd);
				break;
			case "loadSubagents":
				await handleLoadSubagents(cmd);
				break;
			case "stop":
				rl.close();
				process.exit(0);
				break;
		}
	} catch (err) {
		emit({ type: "bridge:error", message: `Invalid command: ${err}` });
	}
});
