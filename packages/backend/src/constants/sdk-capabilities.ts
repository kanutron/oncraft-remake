export interface CapabilityOption<V extends string = string> {
	value: V;
	label: string;
	/** Models for which this value is valid. Omit = valid for all. */
	supportedModels?: ReadonlyArray<string>;
	/** UX hint: render with danger styling. */
	dangerous?: boolean;
}

export const MODELS = [
	{ value: "sonnet", label: "Sonnet" },
	{ value: "opus", label: "Opus" },
	{ value: "haiku", label: "Haiku" },
] as const satisfies ReadonlyArray<CapabilityOption>;

export const EFFORT_LEVELS = [
	{ value: "low", label: "Low" },
	{ value: "medium", label: "Medium" },
	{ value: "high", label: "High" },
	{ value: "xhigh", label: "X-High", supportedModels: ["opus"] },
	{ value: "max", label: "Max", supportedModels: ["opus"] },
] as const satisfies ReadonlyArray<CapabilityOption>;

export const PERMISSION_MODES = [
	{ value: "default", label: "Ask first" },
	{ value: "plan", label: "Plan" },
	{ value: "acceptEdits", label: "Accept edits" },
	{ value: "auto", label: "Auto" },
	{ value: "dontAsk", label: "Don't ask" },
	{ value: "bypassPermissions", label: "Bypass", dangerous: true },
] as const satisfies ReadonlyArray<CapabilityOption>;

export const THINKING_MODES = [
	{ value: "off", label: "Off" },
	{ value: "adaptive", label: "Adaptive" },
	{ value: "fixed", label: "Fixed budget" },
] as const satisfies ReadonlyArray<CapabilityOption>;

export const DEFAULT_THINKING_BUDGET = 8000;

export type ThinkingMode = (typeof THINKING_MODES)[number]["value"];
