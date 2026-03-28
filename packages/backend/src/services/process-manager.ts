import { join } from "node:path";
import type { EventBus } from "../infra/event-bus";

const BRIDGE_PATH = join(import.meta.dir, "../bridge/session-bridge.ts");

interface ManagedProcess {
	proc: ReturnType<typeof Bun.spawn>;
	sessionId: string;
	cwd: string;
}

export class ProcessManager {
	private processes = new Map<string, ManagedProcess>();

	constructor(private eventBus: EventBus) {}

	async spawn(
		sessionId: string,
		cwd: string,
		env: Record<string, string> = {},
	): Promise<void> {
		if (this.processes.has(sessionId)) {
			throw new Error(`Process already exists for session ${sessionId}`);
		}

		const proc = Bun.spawn(["bun", BRIDGE_PATH], {
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			cwd,
			env: { ...process.env, ...env },
		});

		const managed: ManagedProcess = { proc, sessionId, cwd };
		this.processes.set(sessionId, managed);

		// Read stdout line by line and emit events
		this.readLines(sessionId, proc.stdout as ReadableStream<Uint8Array>);

		// Capture stderr and forward as bridge:stderr events
		this.readStderr(sessionId, proc.stderr as ReadableStream<Uint8Array>);

		// Handle process exit
		proc.exited.then((code) => {
			this.processes.delete(sessionId);
			this.eventBus.emit(cwd, "session:process-exit", { sessionId, code });
		});
	}

	send(sessionId: string, command: Record<string, unknown>): void {
		const managed = this.processes.get(sessionId);
		if (!managed) throw new Error(`No process for session ${sessionId}`);
		managed.proc.stdin.write(`${JSON.stringify(command)}\n`);
	}

	async stop(sessionId: string): Promise<void> {
		const managed = this.processes.get(sessionId);
		if (!managed) return;
		this.send(sessionId, { cmd: "stop" });
		await managed.proc.exited;
	}

	kill(sessionId: string): void {
		const managed = this.processes.get(sessionId);
		if (!managed) return;
		managed.proc.kill();
		this.processes.delete(sessionId);
	}

	isAlive(sessionId: string): boolean {
		return this.processes.has(sessionId);
	}

	async waitForReady(sessionId: string, timeoutMs = 5000): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error("Bridge ready timeout")),
				timeoutMs,
			);
			const unsub = this.eventBus.on("*", "session:message", (data) => {
				const msg = data as { sessionId: string; type: string };
				if (msg.sessionId === sessionId && msg.type === "bridge:ready") {
					clearTimeout(timer);
					unsub();
					resolve();
				}
			});
		});
	}

	async stopAll(): Promise<void> {
		const promises = Array.from(this.processes.keys()).map((id) =>
			this.stop(id),
		);
		await Promise.allSettled(promises);
	}

	private async readStderr(
		sessionId: string,
		stderr: ReadableStream<Uint8Array>,
	): Promise<void> {
		const decoder = new TextDecoder();
		const reader = stderr.getReader();
		let buffer = "";

		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				let newlineIdx = buffer.indexOf("\n");
				while (newlineIdx !== -1) {
					const line = buffer.slice(0, newlineIdx).trim();
					buffer = buffer.slice(newlineIdx + 1);
					if (line) {
						const managed = this.processes.get(sessionId);
						const path = managed?.cwd ?? "*";
						this.eventBus.emit(path, "session:message", {
							sessionId,
							type: "bridge:stderr",
							message: line,
						});
					}
					newlineIdx = buffer.indexOf("\n");
				}
			}
		} catch {
			// Stream closed
		}
	}

	private async readLines(
		sessionId: string,
		stdout: ReadableStream<Uint8Array>,
	): Promise<void> {
		const decoder = new TextDecoder();
		const reader = stdout.getReader();
		let buffer = "";

		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				let newlineIdx = buffer.indexOf("\n");
				while (newlineIdx !== -1) {
					const line = buffer.slice(0, newlineIdx);
					buffer = buffer.slice(newlineIdx + 1);
					if (line.trim()) {
						try {
							const event = JSON.parse(line);
							const managed = this.processes.get(sessionId);
							const path = managed?.cwd ?? "*";
							this.eventBus.emit(path, "session:message", {
								sessionId,
								...event,
							});
						} catch {
							// Non-JSON output, ignore
						}
					}
					newlineIdx = buffer.indexOf("\n");
				}
			}
		} catch {
			// Stream closed
		}
	}
}
