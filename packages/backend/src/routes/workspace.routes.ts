import type { FastifyInstance } from "fastify";
import type { WorkspaceService } from "../services/workspace.service";

export function registerWorkspaceRoutes(
	app: FastifyInstance,
	workspaceService: WorkspaceService,
): void {
	app.post("/workspaces", async (request, reply) => {
		const { path, name } = request.body as { path: string; name?: string };
		try {
			const workspace = await workspaceService.open(path, name);
			return workspace;
		} catch (err) {
			return reply
				.status(400)
				.send({ error: (err as Error).message, code: "INVALID_PATH" });
		}
	});

	app.get("/workspaces", async () => {
		return workspaceService.list();
	});

	app.get("/workspaces/:id", async (request, reply) => {
		const { id } = request.params as { id: string };
		const workspace = await workspaceService.get(id);
		if (!workspace)
			return reply
				.status(404)
				.send({ error: "Workspace not found", code: "NOT_FOUND" });
		return workspace;
	});

	app.delete("/workspaces/:id", async (request, reply) => {
		const { id } = request.params as { id: string };
		await workspaceService.close(id);
		return reply.status(204).send();
	});
}
