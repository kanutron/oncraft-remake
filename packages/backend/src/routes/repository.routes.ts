import type { FastifyInstance } from "fastify";
import type { RepositoryService } from "../services/repository.service";

export function registerRepositoryRoutes(
	app: FastifyInstance,
	repositoryService: RepositoryService,
): void {
	app.post("/repositories", async (request, reply) => {
		const { path, name } = request.body as { path: string; name?: string };
		try {
			const repo = await repositoryService.open(path, name);
			return repo;
		} catch (err) {
			return reply
				.status(400)
				.send({ error: (err as Error).message, code: "INVALID_PATH" });
		}
	});

	app.get("/repositories", async () => {
		return repositoryService.list();
	});

	app.get("/repositories/:id", async (request, reply) => {
		const { id } = request.params as { id: string };
		const repo = await repositoryService.get(id);
		if (!repo)
			return reply
				.status(404)
				.send({ error: "Repository not found", code: "NOT_FOUND" });
		return repo;
	});

	app.delete("/repositories/:id", async (request, reply) => {
		const { id } = request.params as { id: string };
		await repositoryService.close(id);
		return reply.status(204).send();
	});
}
