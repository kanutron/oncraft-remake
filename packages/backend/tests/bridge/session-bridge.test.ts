import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const BRIDGE_PATH = join(import.meta.dir, "../../src/bridge/session-bridge.ts");
const MOCK_SDK_PATH = join(import.meta.dir, "fixtures/mock-sdk.ts");

function spawnBridge(env: Record<string, string> = {}) {
	const proc = Bun.spawn(["bun", BRIDGE_PATH], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, ...env },
	});
	return proc;
}

async function readLine(stream: ReadableStream<Uint8Array>): Promise<string> {
	const decoder = new TextDecoder();
	const reader = stream.getReader();
	let buffer = "";
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const newlineIdx = buffer.indexOf("\n");
			if (newlineIdx !== -1) {
				return buffer.slice(0, newlineIdx);
			}
		}
	} finally {
		reader.releaseLock();
	}
	return buffer;
}

function sendCommand(
	proc: ReturnType<typeof spawnBridge>,
	cmd: Record<string, unknown>,
) {
	proc.stdin.write(`${JSON.stringify(cmd)}\n`);
}

/**
 * Spawn the bridge with the mock SDK, send a start command, collect all events
 * until a stop condition is met (terminal event found or timeout), and return
 * all captured events.
 *
 * `stopWhen` — predicate called on each parsed event; collection ends when it
 * returns true. Defaults to stopping on `bridge:test:options_captured`.
 * Pass `() => false` to collect until timeout (useful for error-path tests).
 */
async function runStartAndCaptureEvents(
	startCmd: Record<string, unknown>,
	{
		stopWhen = (e: Record<string, unknown>) =>
			e.type === "bridge:test:options_captured",
		timeoutMs = 5000,
	}: {
		stopWhen?: (e: Record<string, unknown>) => boolean;
		timeoutMs?: number;
	} = {},
): Promise<{ events: Record<string, unknown>[] }> {
	const proc = spawnBridge({ ONCRAFT_SDK_PATH: MOCK_SDK_PATH });
	const decoder = new TextDecoder();
	const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();

	const events: Record<string, unknown>[] = [];
	let buffer = "";
	let timedOut = false;

	const collectLines = async () => {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const event = JSON.parse(line) as Record<string, unknown>;
					events.push(event);
					if (stopWhen(event)) return;
				} catch {
					// ignore non-JSON lines
				}
			}
		}
	};

	let timer: ReturnType<typeof setTimeout> | null = null;
	const timeoutPromise = new Promise<void>((_, reject) => {
		timer = setTimeout(() => {
			timedOut = true;
			reject(new Error(`Timeout (${timeoutMs}ms) waiting for stop condition`));
		}, timeoutMs);
	});

	try {
		sendCommand(proc, startCmd);
		await Promise.race([collectLines(), timeoutPromise]);
	} finally {
		if (timer !== null) clearTimeout(timer);
		reader.releaseLock();
		proc.kill();
		await proc.exited;
	}

	if (timedOut) {
		throw new Error(`Timeout (${timeoutMs}ms) waiting for stop condition`);
	}

	return { events };
}

/**
 * Convenience wrapper: run a start command and return only the captured SDK
 * options from the mock's `bridge:test:options_captured` event.
 */
async function runStartAndCaptureOptions(
	startCmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const { events } = await runStartAndCaptureEvents(startCmd);
	const ev = events.find((e) => e.type === "bridge:test:options_captured");
	if (!ev) {
		throw new Error("bridge:test:options_captured event not received");
	}
	return ev.options as Record<string, unknown>;
}

describe("Session Bridge", () => {
	test("emits bridge:ready on startup", async () => {
		const proc = spawnBridge();
		const line = await readLine(proc.stdout as ReadableStream<Uint8Array>);
		const event = JSON.parse(line);
		expect(event.type).toBe("bridge:ready");
		sendCommand(proc, { cmd: "stop" });
		await proc.exited;
	});

	test("responds to stop command by exiting cleanly", async () => {
		const proc = spawnBridge();
		await readLine(proc.stdout as ReadableStream<Uint8Array>); // bridge:ready
		sendCommand(proc, { cmd: "stop" });
		const exitCode = await proc.exited;
		expect(exitCode).toBe(0);
	});

	test("emits bridge:error for invalid JSON input", async () => {
		const proc = spawnBridge();
		await readLine(proc.stdout as ReadableStream<Uint8Array>); // bridge:ready

		// Send invalid JSON
		proc.stdin.write("not valid json\n");

		const line = await readLine(proc.stdout as ReadableStream<Uint8Array>);
		const event = JSON.parse(line);
		expect(event.type).toBe("bridge:error");
		expect(event.message).toContain("Invalid command");

		sendCommand(proc, { cmd: "stop" });
		await proc.exited;
	});
});

describe("bridge — SDK options wiring", () => {
	test("forwards model, effort, permissionMode, fallbackModel, and adaptive thinking", async () => {
		const capturedOptions = await runStartAndCaptureOptions({
			cmd: "start",
			projectPath: "/tmp",
			prompt: "hi",
			model: "opus",
			effort: "xhigh",
			permissionMode: "plan",
			fallbackModel: "sonnet",
			thinkingMode: "adaptive",
		});
		expect(capturedOptions.model).toBe("opus");
		expect(capturedOptions.effort).toBe("xhigh");
		expect(capturedOptions.permissionMode).toBe("plan");
		expect(capturedOptions.fallbackModel).toBe("sonnet");
		expect(capturedOptions.thinking).toEqual({ type: "adaptive" });
	});

	test("encodes fixed thinking with budgetTokens", async () => {
		const capturedOptions = await runStartAndCaptureOptions({
			cmd: "start",
			projectPath: "/tmp",
			prompt: "hi",
			thinkingMode: "fixed",
			thinkingBudget: 9000,
		});
		expect(capturedOptions.thinking).toEqual({
			type: "enabled",
			budgetTokens: 9000,
		});
	});

	test("encodes off thinking as disabled", async () => {
		const capturedOptions = await runStartAndCaptureOptions({
			cmd: "start",
			projectPath: "/tmp",
			prompt: "hi",
			thinkingMode: "off",
		});
		expect(capturedOptions.thinking).toEqual({ type: "disabled" });
	});

	test("omits undefined fields so SDK Zod validation is not triggered", async () => {
		const capturedOptions = await runStartAndCaptureOptions({
			cmd: "start",
			projectPath: "/tmp",
			prompt: "hi",
		});
		expect(capturedOptions).not.toHaveProperty("model");
		expect(capturedOptions).not.toHaveProperty("effort");
		expect(capturedOptions).not.toHaveProperty("thinking");
		expect(capturedOptions).not.toHaveProperty("fallbackModel");
	});

	test("emits a bridge:error and aborts when thinkingMode=fixed has no valid budget", async () => {
		const { events } = await runStartAndCaptureEvents(
			{
				cmd: "start",
				projectPath: "/tmp",
				prompt: "hi",
				thinkingMode: "fixed",
				// thinkingBudget intentionally missing
			},
			{
				// Stop as soon as we see either the error or the options-captured event.
				// The error path must NOT emit options_captured.
				stopWhen: (e) =>
					e.type === "bridge:error" ||
					e.type === "bridge:test:options_captured",
			},
		);
		const err = events.find((e: { type: string }) => e.type === "bridge:error");
		expect(err).toBeDefined();
		expect((err as { message: string }).message).toMatch(/thinkingBudget/);
		// sdk.query must never have been called
		expect(
			events.find(
				(e: { type: string }) => e.type === "bridge:test:options_captured",
			),
		).toBeUndefined();
	});

	test("emits a bridge:error when thinkingMode=fixed has a non-positive budget", async () => {
		const { events } = await runStartAndCaptureEvents(
			{
				cmd: "start",
				projectPath: "/tmp",
				prompt: "hi",
				thinkingMode: "fixed",
				thinkingBudget: 0,
			},
			{
				stopWhen: (e) =>
					e.type === "bridge:error" ||
					e.type === "bridge:test:options_captured",
			},
		);
		const err = events.find((e: { type: string }) => e.type === "bridge:error");
		expect(err).toBeDefined();
	});
});
