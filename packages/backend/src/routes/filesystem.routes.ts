import type { FastifyInstance } from "fastify";
import type { FilesystemService } from "../services/filesystem.service";

export function registerFilesystemRoutes(
	app: FastifyInstance,
	filesystemService: FilesystemService,
): void {
	app.get("/filesystem/list-dirs", async (request, reply) => {
		const { path } = request.query as { path?: string };

		if (!path) {
			return reply.status(400).send({
				error: "Missing required query parameter: path",
				code: "BAD_REQUEST",
			});
		}

		try {
			return await filesystemService.listDirs(path);
		} catch (err) {
			const error = err as Error & { code?: string };
			if (error.code === "FORBIDDEN") {
				return reply
					.status(403)
					.send({ error: error.message, code: "FORBIDDEN" });
			}
			if (error.code === "NOT_FOUND") {
				return reply
					.status(404)
					.send({ error: error.message, code: "NOT_FOUND" });
			}
			return reply.status(500).send({ error: error.message, code: "INTERNAL" });
		}
	});
}
