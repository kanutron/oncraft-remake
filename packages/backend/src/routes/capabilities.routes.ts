import type { FastifyInstance } from "fastify";
import {
	DEFAULT_THINKING_BUDGET,
	EFFORT_LEVELS,
	MODELS,
	PERMISSION_MODES,
	THINKING_MODES,
} from "../constants/sdk-capabilities";

export function registerCapabilitiesRoutes(app: FastifyInstance): void {
	app.get("/sdk/capabilities", async () => ({
		models: MODELS,
		effortLevels: EFFORT_LEVELS,
		permissionModes: PERMISSION_MODES,
		thinkingModes: THINKING_MODES,
		defaultThinkingBudget: DEFAULT_THINKING_BUDGET,
	}));
}
