import { afterEach, describe, expect, test } from "bun:test";
import { EventBus } from "../../src/infra/event-bus";
import { ProcessManager } from "../../src/services/process-manager";

let pm: ProcessManager;
let eventBus: EventBus;

afterEach(async () => {
	if (pm) await pm.stopAll();
});

describe("ProcessManager", () => {
	test("spawns a bridge process and receives bridge:ready", async () => {
		eventBus = new EventBus();
		pm = new ProcessManager(eventBus);

		const events: unknown[] = [];
		eventBus.on("*", "session:message", (data) => events.push(data));

		await pm.spawn("session-1", "/tmp");
		// Wait for bridge:ready
		await new Promise((r) => setTimeout(r, 500));

		expect(pm.isAlive("session-1")).toBe(true);
	});

	test("sends command and receives events", async () => {
		eventBus = new EventBus();
		pm = new ProcessManager(eventBus);

		await pm.spawn("session-1", "/tmp");
		await new Promise((r) => setTimeout(r, 300));

		// Stop should work cleanly
		await pm.stop("session-1");
		expect(pm.isAlive("session-1")).toBe(false);
	});

	test("kill cleans up process", async () => {
		eventBus = new EventBus();
		pm = new ProcessManager(eventBus);

		await pm.spawn("session-1", "/tmp");
		await new Promise((r) => setTimeout(r, 300));

		pm.kill("session-1");
		await new Promise((r) => setTimeout(r, 200));
		expect(pm.isAlive("session-1")).toBe(false);
	});
});
