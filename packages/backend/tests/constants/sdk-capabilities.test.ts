import { describe, expect, it } from "bun:test";
import {
	DEFAULT_THINKING_BUDGET,
	EFFORT_LEVELS,
	MODELS,
	PERMISSION_MODES,
	THINKING_MODES,
} from "../../src/constants/sdk-capabilities";

describe("sdk-capabilities", () => {
	it("exposes the current SDK model aliases", () => {
		expect(MODELS.map((m) => m.value)).toEqual(["sonnet", "opus", "haiku"]);
	});

	it("exposes all five SDK effort levels", () => {
		expect(EFFORT_LEVELS.map((e) => e.value)).toEqual([
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		]);
	});

	it("restricts xhigh and max to opus", () => {
		const xhigh = EFFORT_LEVELS.find((e) => e.value === "xhigh");
		const max = EFFORT_LEVELS.find((e) => e.value === "max");
		expect(xhigh?.supportedModels).toEqual(["opus"]);
		expect(max?.supportedModels).toEqual(["opus"]);
	});

	it("exposes all SDK permission modes with bypass flagged dangerous", () => {
		expect(PERMISSION_MODES.map((p) => p.value).sort()).toEqual([
			"acceptEdits",
			"auto",
			"bypassPermissions",
			"default",
			"dontAsk",
			"plan",
		]);
		const bypass = PERMISSION_MODES.find(
			(p) => p.value === "bypassPermissions",
		);
		expect(bypass?.dangerous).toBe(true);
	});

	it("exposes three thinking modes and a positive default budget", () => {
		expect(THINKING_MODES.map((t) => t.value)).toEqual([
			"off",
			"adaptive",
			"fixed",
		]);
		expect(DEFAULT_THINKING_BUDGET).toBeGreaterThan(0);
	});
});
