import type { FastifyInstance } from "fastify";
import type { GitService } from "../services/git.service";
import type { WorkspaceService } from "../services/workspace.service";

export function registerGitRoutes(
	_app: FastifyInstance,
	_workspaceService: WorkspaceService,
	_gitService: GitService,
): void {
	// Implemented in Task 7.3
}
