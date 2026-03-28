import { unlinkSync } from "node:fs";
import Fastify from "fastify";
import { EventBus } from "../../src/infra/event-bus";
import { GitWatcher } from "../../src/infra/git-watcher";
import { Store } from "../../src/infra/store";
import { registerGitRoutes } from "../../src/routes/git.routes";
import { registerSessionRoutes } from "../../src/routes/session.routes";
import { registerWorkspaceRoutes } from "../../src/routes/workspace.routes";
import { GitService } from "../../src/services/git.service";
import { ProcessManager } from "../../src/services/process-manager";
import { SessionService } from "../../src/services/session.service";
import { WorkspaceService } from "../../src/services/workspace.service";

export async function buildApp() {
	const dbPath = `/tmp/oncraft-route-test-${Date.now()}.db`;
	const store = new Store(dbPath);
	const eventBus = new EventBus();
	const gitService = new GitService();
	const gitWatcher = new GitWatcher(eventBus, gitService);
	const processManager = new ProcessManager(eventBus);
	const workspaceService = new WorkspaceService(store, gitService, gitWatcher);
	const sessionService = new SessionService(
		store,
		eventBus,
		gitService,
		processManager,
	);

	const app = Fastify();
	registerWorkspaceRoutes(app, workspaceService);
	registerSessionRoutes(app, sessionService);
	registerGitRoutes(app, workspaceService, gitService);
	await app.ready();

	const originalClose = app.close.bind(app);
	app.close = async () => {
		await processManager.stopAll();
		await gitWatcher.unwatchAll();
		store.close();
		try {
			unlinkSync(dbPath);
		} catch {}
		try {
			unlinkSync(`${dbPath}-wal`);
		} catch {}
		try {
			unlinkSync(`${dbPath}-shm`);
		} catch {}
		return originalClose();
	};

	return app;
}
