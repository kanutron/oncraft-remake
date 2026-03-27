import { describe, expect, mock, test } from "bun:test";
import { EventBus } from "../../src/infra/event-bus";

describe("EventBus", () => {
	test("subscribes to exact path and receives events", () => {
		const bus = new EventBus();
		const handler = mock(() => {});
		bus.on("/repo/main", "git:branch-changed", handler);
		bus.emit("/repo/main", "git:branch-changed", { from: "dev", to: "main" });
		expect(handler).toHaveBeenCalledWith({ from: "dev", to: "main" });
	});

	test("does not receive events for different paths", () => {
		const bus = new EventBus();
		const handler = mock(() => {});
		bus.on("/repo/main", "git:branch-changed", handler);
		bus.emit("/repo/worktree-1", "git:branch-changed", { from: "a", to: "b" });
		expect(handler).not.toHaveBeenCalled();
	});

	test("does not receive events for different event types", () => {
		const bus = new EventBus();
		const handler = mock(() => {});
		bus.on("/repo/main", "git:branch-changed", handler);
		bus.emit("/repo/main", "git:status-changed", { files: 3 });
		expect(handler).not.toHaveBeenCalled();
	});

	test("wildcard path receives all events of a type", () => {
		const bus = new EventBus();
		const handler = mock(() => {});
		bus.on("*", "git:branch-changed", handler);
		bus.emit("/any/path", "git:branch-changed", { from: "a", to: "b" });
		expect(handler).toHaveBeenCalledTimes(1);
	});

	test("unsubscribe stops receiving events", () => {
		const bus = new EventBus();
		const handler = mock(() => {});
		const unsub = bus.on("/repo/main", "git:branch-changed", handler);
		unsub();
		bus.emit("/repo/main", "git:branch-changed", { from: "a", to: "b" });
		expect(handler).not.toHaveBeenCalled();
	});

	test("multiple subscribers on same path+event all receive", () => {
		const bus = new EventBus();
		const h1 = mock(() => {});
		const h2 = mock(() => {});
		bus.on("/repo/main", "git:branch-changed", h1);
		bus.on("/repo/main", "git:branch-changed", h2);
		bus.emit("/repo/main", "git:branch-changed", { from: "a", to: "b" });
		expect(h1).toHaveBeenCalledTimes(1);
		expect(h2).toHaveBeenCalledTimes(1);
	});
});
