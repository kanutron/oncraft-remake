import Fastify from "fastify";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ status: "ok" }));

const start = async () => {
	const port = Number(process.env.PORT) || 3001;
	await app.listen({ port, host: "0.0.0.0" });
	console.log(`OnCraft backend listening on port ${port}`);
};

start();
