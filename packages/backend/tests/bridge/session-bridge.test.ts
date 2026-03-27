import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const BRIDGE_PATH = join(import.meta.dir, "../../src/bridge/session-bridge.ts");

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
