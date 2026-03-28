import type { FastifyInstance } from "fastify";
import type { SessionService } from "../services/session.service";

export function registerSessionRoutes(
	app: FastifyInstance,
	sessionService: SessionService,
): void {
	app.post("/workspaces/:workspaceId/sessions", async (request, reply) => {
		const { workspaceId } = request.params as { workspaceId: string };
		const { name, sourceBranch, targetBranch, useWorktree } = request.body as {
			name: string;
			sourceBranch: string;
			targetBranch: string;
			useWorktree: boolean;
		};
		if (!sourceBranch || !targetBranch) {
			return reply.status(400).send({
				error: "sourceBranch and targetBranch are required",
				code: "VALIDATION",
			});
		}
		try {
			return await sessionService.create(workspaceId, {
				name,
				sourceBranch,
				targetBranch,
				useWorktree,
			});
		} catch (err) {
			return reply
				.status(400)
				.send({ error: (err as Error).message, code: "CREATE_FAILED" });
		}
	});

	app.get("/workspaces/:workspaceId/sessions", async (request) => {
		const { workspaceId } = request.params as { workspaceId: string };
		return sessionService.list(workspaceId);
	});

	app.get("/sessions/:id", async (request, reply) => {
		const { id } = request.params as { id: string };
		const session = sessionService.get(id);
		if (!session)
			return reply
				.status(404)
				.send({ error: "Session not found", code: "NOT_FOUND" });
		return session;
	});

	app.patch("/sessions/:id", async (request, reply) => {
		const { id } = request.params as { id: string };
		const session = sessionService.get(id);
		if (!session)
			return reply
				.status(404)
				.send({ error: "Session not found", code: "NOT_FOUND" });
		const updates = request.body as {
			name?: string;
			targetBranch?: string;
		};
		sessionService.update(id, updates);
		return sessionService.get(id);
	});

	app.get("/sessions/:id/history", async (request, reply) => {
		const { id } = request.params as { id: string };
		try {
			await sessionService.loadHistory(id);
			return { sessionId: id, status: "loading" };
		} catch (err) {
			return reply
				.status(400)
				.send({ error: (err as Error).message, code: "HISTORY_FAILED" });
		}
	});

	app.delete("/sessions/:id", async (request, reply) => {
		const { id } = request.params as { id: string };
		await sessionService.destroy(id);
		return reply.status(204).send();
	});

	app.post("/sessions/:id/send", async (request, reply) => {
		const { id } = request.params as { id: string };
		const { message, model, effort, permissionMode } = request.body as {
			message: string;
			model?: string;
			effort?: string;
			permissionMode?: string;
		};
		try {
			await sessionService.send(id, message, {
				model,
				effort,
				permissionMode,
			});
			return reply.status(202).send({ sessionId: id });
		} catch (err) {
			return reply
				.status(400)
				.send({ error: (err as Error).message, code: "SEND_FAILED" });
		}
	});

	app.post("/sessions/:id/reply", async (request, reply) => {
		const { id } = request.params as { id: string };
		const { toolUseID, decision } = request.body as {
			toolUseID: string;
			decision: "allow" | "deny";
		};
		sessionService.reply(id, toolUseID, decision);
		return { sessionId: id };
	});

	app.post("/sessions/:id/interrupt", async (request) => {
		const { id } = request.params as { id: string };
		sessionService.interrupt(id);
		return { sessionId: id, state: "idle" };
	});

	app.post("/sessions/:id/stop", async (request) => {
		const { id } = request.params as { id: string };
		await sessionService.stop(id);
		return { sessionId: id, state: "stopped" };
	});

	app.post("/sessions/:id/resume", async (request, reply) => {
		const { id } = request.params as { id: string };
		try {
			await sessionService.resume(id);
			return sessionService.get(id);
		} catch (err) {
			return reply
				.status(400)
				.send({ error: (err as Error).message, code: "RESUME_FAILED" });
		}
	});
}
