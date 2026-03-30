import { unlinkSync } from "node:fs";
import { homedir } from "node:os";
import Fastify from "fastify";
import { EventBus } from "../../src/infra/event-bus";
import { GitWatcher } from "../../src/infra/git-watcher";
import { Store } from "../../src/infra/store";
import { registerFilesystemRoutes } from "../../src/routes/filesystem.routes";
import { registerGitRoutes } from "../../src/routes/git.routes";
import { registerRepositoryRoutes } from "../../src/routes/repository.routes";
import { registerSessionRoutes } from "../../src/routes/session.routes";
import { FilesystemService } from "../../src/services/filesystem.service";
import { GitService } from "../../src/services/git.service";
import { ProcessManager } from "../../src/services/process-manager";
import { RepositoryService } from "../../src/services/repository.service";
import { SessionService } from "../../src/services/session.service";

export async function buildApp(opts?: { fsRoot?: string }) {
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
		eventBus,
	);
	const sessionService = new SessionService(
		store,
		eventBus,
		gitService,
		processManager,
	);
	repositoryService.setSessionService(sessionService);
	const filesystemService = new FilesystemService(opts?.fsRoot ?? homedir());

	const app = Fastify();
	registerRepositoryRoutes(app, repositoryService);
	registerSessionRoutes(app, sessionService);
	registerGitRoutes(app, repositoryService, gitService);
	registerFilesystemRoutes(app, filesystemService);
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
