import type { FastifyInstance } from "fastify";
import type { GitService } from "../services/git.service";
import type { WorkspaceService } from "../services/workspace.service";

export function registerGitRoutes(
	app: FastifyInstance,
	workspaceService: WorkspaceService,
	gitService: GitService,
): void {
	async function getWorkspacePath(id: string): Promise<string> {
		const ws = await workspaceService.get(id);
		if (!ws) throw new Error("Workspace not found");
		return ws.path;
	}

	app.get("/workspaces/:id/git/status", async (request, reply) => {
		const { id } = request.params as { id: string };
		try {
			const path = await getWorkspacePath(id);
			return await gitService.getStatus(path);
		} catch (err) {
			return reply
				.status(404)
				.send({ error: (err as Error).message, code: "NOT_FOUND" });
		}
	});

	app.get("/workspaces/:id/git/branches", async (request, reply) => {
		const { id } = request.params as { id: string };
		try {
			const path = await getWorkspacePath(id);
			return await gitService.listBranches(path);
		} catch (err) {
			return reply
				.status(404)
				.send({ error: (err as Error).message, code: "NOT_FOUND" });
		}
	});

	app.get("/workspaces/:id/git/worktrees", async (request, reply) => {
		const { id } = request.params as { id: string };
		try {
			const path = await getWorkspacePath(id);
			return await gitService.listWorktrees(path);
		} catch (err) {
			return reply
				.status(404)
				.send({ error: (err as Error).message, code: "NOT_FOUND" });
		}
	});

	app.post("/workspaces/:id/git/checkout", async (request, reply) => {
		const { id } = request.params as { id: string };
		const { branch, path: targetPath } = request.body as {
			branch: string;
			path?: string;
		};
		try {
			const wsPath = await getWorkspacePath(id);
			await gitService.checkout(targetPath ?? wsPath, branch);
			return { status: "ok", branch };
		} catch (err) {
			return reply
				.status(400)
				.send({ error: (err as Error).message, code: "CHECKOUT_FAILED" });
		}
	});

	app.post("/workspaces/:id/git/branch", async (request, reply) => {
		const { id } = request.params as { id: string };
		const { name, from } = request.body as { name: string; from?: string };
		try {
			const path = await getWorkspacePath(id);
			await gitService.createBranch(path, name, from);
			return { status: "ok", branch: name };
		} catch (err) {
			return reply
				.status(400)
				.send({ error: (err as Error).message, code: "BRANCH_FAILED" });
		}
	});

	app.post("/workspaces/:id/git/merge", async (request, reply) => {
		const { id } = request.params as { id: string };
		const { source } = request.body as { source: string };
		try {
			const path = await getWorkspacePath(id);
			await gitService.merge(path, source);
			return { status: "ok" };
		} catch (err) {
			return reply
				.status(409)
				.send({ error: (err as Error).message, code: "MERGE_CONFLICT" });
		}
	});

	app.post("/workspaces/:id/git/rebase", async (request, reply) => {
		const { id } = request.params as { id: string };
		const { branch, onto } = request.body as {
			branch: string;
			onto: string;
		};
		try {
			const path = await getWorkspacePath(id);
			await gitService.rebase(path, branch, onto);
			return { status: "ok" };
		} catch (err) {
			return reply
				.status(409)
				.send({ error: (err as Error).message, code: "REBASE_CONFLICT" });
		}
	});
}
