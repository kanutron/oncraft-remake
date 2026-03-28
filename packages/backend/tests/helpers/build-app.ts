import { unlinkSync } from "node:fs";
import Fastify from "fastify";
import { EventBus } from "../../src/infra/event-bus";
import { GitWatcher } from "../../src/infra/git-watcher";
import { Store } from "../../src/infra/store";
import { registerGitRoutes } from "../../src/routes/git.routes";
import { registerRepositoryRoutes } from "../../src/routes/repository.routes";
import { registerSessionRoutes } from "../../src/routes/session.routes";
import { GitService } from "../../src/services/git.service";
import { ProcessManager } from "../../src/services/process-manager";
import { RepositoryService } from "../../src/services/repository.service";
import { SessionService } from "../../src/services/session.service";

export async function buildApp() {
	const dbPath = `/tmp/oncraft-route-test-${Date.now()}.db`;
	const store = new Store(dbPath);
	const eventBus = new EventBus();
	const gitService = new GitService();
	const gitWatcher = new GitWatcher(eventBus, gitService);
	const processManager = new ProcessManager(eventBus);
	const repositoryService = new RepositoryService(
		store,
		gitService,
		gitWatcher,
	);
	const sessionService = new SessionService(
		store,
		eventBus,
		gitService,
		processManager,
	);

	const app = Fastify();
	registerRepositoryRoutes(app, repositoryService);
	registerSessionRoutes(app, sessionService);
	registerGitRoutes(app, repositoryService, gitService);
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
