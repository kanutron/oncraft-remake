import type { FastifyInstance } from "fastify";
import type { ProjectService } from "../services/project.service";

export function registerProjectRoutes(
	app: FastifyInstance,
	projectService: ProjectService,
): void {
	app.get("/project", async (_request, reply) => {
		const project = projectService.get();
		if (!project)
			return reply
				.status(404)
				.send({ error: "No project configured", code: "NOT_FOUND" });
		return project;
	});

	app.patch("/project", async (request) => {
		const { name } = request.body as { name?: string };
		const project = projectService.update({ name });
		return project;
	});
}
