import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";

import { EventBus } from "./infra/event-bus";
import { GitWatcher } from "./infra/git-watcher";
import { Store } from "./infra/store";
import { registerFilesystemRoutes } from "./routes/filesystem.routes";
import { registerGitRoutes } from "./routes/git.routes";
import { registerProjectRoutes } from "./routes/project.routes";
import { registerRepositoryRoutes } from "./routes/repository.routes";
import { registerSessionRoutes } from "./routes/session.routes";
import { registerWSRoutes } from "./routes/ws.routes";
import { FilesystemService } from "./services/filesystem.service";
import { GitService } from "./services/git.service";
import { ProcessManager } from "./services/process-manager";
import { ProjectService } from "./services/project.service";
import { RepositoryService } from "./services/repository.service";
import { SessionService } from "./services/session.service";

const app = Fastify({ logger: true });

// Plugins
await app.register(fastifyCors, {
	origin: process.env.CORS_ORIGIN || "http://localhost:3100",
});
await app.register(fastifyWebsocket);

// Infrastructure
const store = new Store(process.env.DB_PATH || "oncraft.db");
const eventBus = new EventBus();
const gitService = new GitService();
const gitWatcher = new GitWatcher(eventBus, gitService);
const processManager = new ProcessManager(eventBus);
const projectService = new ProjectService(store);

// Services
const filesystemService = new FilesystemService(
	process.env.ONCRAFT_FS_ROOT || "~",
);
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

// Routes
app.get("/health", async () => ({ status: "ok" }));
registerProjectRoutes(app, projectService);
registerRepositoryRoutes(app, repositoryService);
registerSessionRoutes(app, sessionService);
registerGitRoutes(app, repositoryService, gitService);
registerFilesystemRoutes(app, filesystemService);
registerWSRoutes(app, eventBus, sessionService);

// Lifecycle
app.addHook("onClose", async () => {
	await processManager.stopAll();
	await gitWatcher.unwatchAll();
	store.close();
});

// Start
const port = Number(process.env.PORT) || 3101;
await app.listen({ port, host: "0.0.0.0" });
console.log(`OnCraft backend listening on port ${port}`);
