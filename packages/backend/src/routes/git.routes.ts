import type { FastifyInstance } from "fastify";
import type { GitService } from "../services/git.service";
import type { RepositoryService } from "../services/repository.service";

export function registerGitRoutes(
	app: FastifyInstance,
	repositoryService: RepositoryService,
	gitService: GitService,
): void {
	async function getRepoPath(id: string): Promise<string> {
		const repo = await repositoryService.get(id);
		if (!repo) throw new Error("Repository not found");
		return repo.path;
	}

	app.get("/repositories/:id/git/status", async (request, reply) => {
		const { id } = request.params as { id: string };
		try {
			const path = await getRepoPath(id);
			return await gitService.getStatus(path);
		} catch (err) {
			return reply
				.status(404)
				.send({ error: (err as Error).message, code: "NOT_FOUND" });
		}
	});

	app.get("/repositories/:id/git/branches", async (request, reply) => {
		const { id } = request.params as { id: string };
		try {
			const path = await getRepoPath(id);
			return await gitService.listBranches(path);
		} catch (err) {
			return reply
				.status(404)
				.send({ error: (err as Error).message, code: "NOT_FOUND" });
		}
	});

	app.get("/repositories/:id/git/worktrees", async (request, reply) => {
		const { id } = request.params as { id: string };
		try {
			const path = await getRepoPath(id);
			return await gitService.listWorktrees(path);
		} catch (err) {
			return reply
				.status(404)
				.send({ error: (err as Error).message, code: "NOT_FOUND" });
		}
	});

	app.post("/repositories/:id/git/checkout", async (request, reply) => {
		const { id } = request.params as { id: string };
		const { branch, path: targetPath } = request.body as {
			branch: string;
			path?: string;
		};
		try {
			const repoPath = await getRepoPath(id);
			await gitService.checkout(targetPath ?? repoPath, branch);
			return { status: "ok", branch };
		} catch (err) {
			return reply
				.status(400)
				.send({ error: (err as Error).message, code: "CHECKOUT_FAILED" });
		}
	});

	app.post("/repositories/:id/git/branch", async (request, reply) => {
		const { id } = request.params as { id: string };
		const { name, from } = request.body as { name: string; from?: string };
		try {
			const path = await getRepoPath(id);
			await gitService.createBranch(path, name, from);
			return { status: "ok", branch: name };
		} catch (err) {
			return reply
				.status(400)
				.send({ error: (err as Error).message, code: "BRANCH_FAILED" });
		}
	});

	app.post("/repositories/:id/git/merge", async (request, reply) => {
		const { id } = request.params as { id: string };
		const { source } = request.body as { source: string };
		try {
			const path = await getRepoPath(id);
			await gitService.merge(path, source);
			return { status: "ok" };
		} catch (err) {
			return reply
				.status(409)
				.send({ error: (err as Error).message, code: "MERGE_CONFLICT" });
		}
	});

	app.post("/repositories/:id/git/rebase", async (request, reply) => {
		const { id } = request.params as { id: string };
		const { branch, onto } = request.body as {
			branch: string;
			onto: string;
		};
		try {
			const path = await getRepoPath(id);
			await gitService.rebase(path, branch, onto);
			return { status: "ok" };
		} catch (err) {
			return reply
				.status(409)
				.send({ error: (err as Error).message, code: "REBASE_CONFLICT" });
		}
	});
}
