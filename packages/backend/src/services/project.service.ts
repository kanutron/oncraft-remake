import type { Store } from "../infra/store";
import type { Project } from "../types";

export class ProjectService {
	constructor(private store: Store) {}

	get(): Project | null {
		return this.store.getProject();
	}

	getOrCreate(name: string): Project {
		const existing = this.store.getProject();
		if (existing) {
			this.store.updateProject(existing.id, {});
			return { ...existing, lastOpenedAt: new Date().toISOString() };
		}

		const project: Project = {
			id: crypto.randomUUID(),
			name,
			createdAt: new Date().toISOString(),
			lastOpenedAt: new Date().toISOString(),
		};
		this.store.createProject(project);
		return project;
	}

	update(fields: { name?: string }): Project | null {
		const project = this.store.getProject();
		if (!project) return null;
		this.store.updateProject(project.id, fields);
		return { ...project, ...fields, lastOpenedAt: new Date().toISOString() };
	}
}
