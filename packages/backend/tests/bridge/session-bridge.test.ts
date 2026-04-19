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
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const newlineIdx = buffer.indexOf("\n");
		if (newlineIdx !== -1) {
			reader.releaseLock();
			return buffer.slice(0, newlineIdx);
		}
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
 * until the bridge exits, and return the options object captured by the mock.
 *
 * The mock SDK emits `bridge:test:options_captured` synchronously inside
 * `handleStart` before yielding any messages, so the event always arrives
 * before `bridge:exit` / process exit.
 */
async function runStartAndCaptureOptions(
	startCmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const proc = spawnBridge({ ONCRAFT_SDK_PATH: MOCK_SDK_PATH });
	const decoder = new TextDecoder();
	const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();

	let buffer = "";
	let capturedOptions: Record<string, unknown> | null = null;

	// Read until the process exits (mock SDK yields nothing, so the bridge
	// loop completes quickly and the process exits after receiving `stop`).
	sendCommand(proc, startCmd);

	// Give the bridge a moment to process then stop it.
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
					if (event.type === "bridge:test:options_captured") {
						capturedOptions = event.options as Record<string, unknown>;
					}
				} catch {
					// ignore non-JSON lines
				}
			}
			if (capturedOptions !== null) break;
		}
	};

	await Promise.race([
		collectLines(),
		// Timeout guard: if no options_captured event arrives within 5 s, bail.
		new Promise<void>((_, reject) =>
			setTimeout(
				() => reject(new Error("Timeout waiting for options_captured")),
				5000,
			),
		),
	]);

	sendCommand(proc, { cmd: "stop" });
	await proc.exited;

	if (capturedOptions === null) {
		throw new Error("bridge:test:options_captured event not received");
	}
	return capturedOptions;
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
});
