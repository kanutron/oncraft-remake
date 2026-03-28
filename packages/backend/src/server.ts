import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";

import { EventBus } from "./infra/event-bus";
import { GitWatcher } from "./infra/git-watcher";
import { Store } from "./infra/store";
import { registerGitRoutes } from "./routes/git.routes";
import { registerSessionRoutes } from "./routes/session.routes";
import { registerWorkspaceRoutes } from "./routes/workspace.routes";
import { registerWSRoutes } from "./routes/ws.routes";
import { GitService } from "./services/git.service";
import { ProcessManager } from "./services/process-manager";
import { SessionService } from "./services/session.service";
import { WorkspaceService } from "./services/workspace.service";

const app = Fastify({ logger: true });

// Plugins
await app.register(fastifyCors, {
	origin: process.env.CORS_ORIGIN || "http://localhost:3000",
});
await app.register(fastifyWebsocket);

// Infrastructure
const store = new Store(process.env.DB_PATH || "oncraft.db");
const eventBus = new EventBus();
const gitService = new GitService();
const gitWatcher = new GitWatcher(eventBus, gitService);
const processManager = new ProcessManager(eventBus);

// Services
const workspaceService = new WorkspaceService(store, gitService, gitWatcher);
const sessionService = new SessionService(
	store,
	eventBus,
	gitService,
	processManager,
);

// Routes
app.get("/health", async () => ({ status: "ok" }));
registerWorkspaceRoutes(app, workspaceService);
registerSessionRoutes(app, sessionService);
registerGitRoutes(app, workspaceService, gitService);
registerWSRoutes(app, eventBus, sessionService);

// Lifecycle
app.addHook("onClose", async () => {
	await processManager.stopAll();
	await gitWatcher.unwatchAll();
	store.close();
});

// Start
const port = Number(process.env.PORT) || 3001;
await app.listen({ port, host: "0.0.0.0" });
console.log(`OnCraft backend listening on port ${port}`);
