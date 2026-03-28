import type { FastifyInstance } from "fastify";
import type { EventBus } from "../infra/event-bus";
import type { SessionService } from "../services/session.service";

export function registerWSRoutes(
	app: FastifyInstance,
	eventBus: EventBus,
	sessionService: SessionService,
): void {
	app.get("/ws", { websocket: true }, (socket) => {
		const unsubs: Array<() => void> = [];

		unsubs.push(
			eventBus.on("*", "session:message", (data) => {
				socket.send(
					JSON.stringify({
						event: "session:message",
						...(data as Record<string, unknown>),
					}),
				);
			}),
		);

		unsubs.push(
			eventBus.on("*", "session:state", (data) => {
				socket.send(
					JSON.stringify({
						event: "session:state",
						...(data as Record<string, unknown>),
					}),
				);
			}),
		);

		unsubs.push(
			eventBus.on("*", "session:result", (data) => {
				socket.send(
					JSON.stringify({
						event: "session:result",
						...(data as Record<string, unknown>),
					}),
				);
			}),
		);

		unsubs.push(
			eventBus.on("*", "session:worktree-conflict", (data) => {
				socket.send(
					JSON.stringify({
						event: "session:worktree-conflict",
						...(data as Record<string, unknown>),
					}),
				);
			}),
		);

		unsubs.push(
			eventBus.on("*", "session:branch-mismatch", (data) => {
				socket.send(
					JSON.stringify({
						event: "session:branch-mismatch",
						...(data as Record<string, unknown>),
					}),
				);
			}),
		);

		unsubs.push(
			eventBus.on("*", "git:branch-changed", (data) => {
				socket.send(
					JSON.stringify({
						event: "git:branch-changed",
						...(data as Record<string, unknown>),
					}),
				);
			}),
		);

		unsubs.push(
			eventBus.on("*", "session:process-exit", (data) => {
				socket.send(
					JSON.stringify({
						event: "session:process-exit",
						...(data as Record<string, unknown>),
					}),
				);
			}),
		);

		socket.on("message", (raw) => {
			try {
				const msg = JSON.parse(raw.toString());
				switch (msg.command) {
					case "session:send":
						sessionService.send(msg.sessionId, msg.data.message, msg.data);
						break;
					case "session:reply":
						sessionService.reply(
							msg.sessionId,
							msg.data.toolUseID,
							msg.data.decision,
						);
						break;
					case "session:interrupt":
						sessionService.interrupt(msg.sessionId);
						break;
				}
			} catch (err) {
				socket.send(JSON.stringify({ event: "error", message: String(err) }));
			}
		});

		socket.on("close", () => {
			for (const unsub of unsubs) unsub();
		});
	});
}
