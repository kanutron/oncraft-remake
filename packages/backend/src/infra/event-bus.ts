type Handler = (data: unknown) => void;

interface Subscription {
	path: string;
	event: string;
	handler: Handler;
}

export class EventBus {
	private subscriptions: Subscription[] = [];

	on(path: string, event: string, handler: Handler): () => void {
		const sub: Subscription = { path, event, handler };
		this.subscriptions.push(sub);
		return () => {
			const idx = this.subscriptions.indexOf(sub);
			if (idx !== -1) this.subscriptions.splice(idx, 1);
		};
	}

	emit(path: string, event: string, data: unknown): void {
		for (const sub of this.subscriptions) {
			if (sub.event !== event) continue;
			if (sub.path !== "*" && sub.path !== path) continue;
			sub.handler(data);
		}
	}
}
