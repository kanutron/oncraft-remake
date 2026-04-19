import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import type { CapabilityOption } from "../../src/constants/sdk-capabilities";
import { registerCapabilitiesRoutes } from "../../src/routes/capabilities.routes";

describe("GET /sdk/capabilities", () => {
	let app: FastifyInstance;

	beforeAll(async () => {
		app = Fastify();
		registerCapabilitiesRoutes(app);
		await app.ready();
	});

	afterAll(async () => {
		await app.close();
	});

	it("returns models, effort levels, permission modes, thinking modes, default budget", async () => {
		const res = await app.inject({ method: "GET", url: "/sdk/capabilities" });
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body).toHaveProperty("models");
		expect(body).toHaveProperty("effortLevels");
		expect(body).toHaveProperty("permissionModes");
		expect(body).toHaveProperty("thinkingModes");
		expect(body.defaultThinkingBudget).toBeGreaterThan(0);
		expect(
			body.effortLevels.some((e: CapabilityOption) => e.value === "xhigh"),
		).toBe(true);
	});
});
