import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface DirEntry {
	name: string;
	path: string;
	isGitRepo: boolean;
}

export interface ListDirsResult {
	entries: DirEntry[];
	parent: string | null;
}

export class FilesystemService {
	private readonly root: string;

	constructor(root: string) {
		this.root = resolve(root.replace(/^~/, process.env.HOME || "/"));
	}

	getRoot(): string {
		return this.root;
	}

	async listDirs(path: string): Promise<ListDirsResult> {
		const resolved = resolve(path.replace(/^~/, process.env.HOME || "/"));

		const rootWithSep = this.root.endsWith("/") ? this.root : `${this.root}/`;
		if (!resolved.startsWith(rootWithSep) && resolved !== this.root) {
			throw Object.assign(new Error("FORBIDDEN: path outside allowed root"), {
				code: "FORBIDDEN",
			});
		}

		if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
			throw Object.assign(
				new Error("NOT_FOUND: path does not exist or is not a directory"),
				{
					code: "NOT_FOUND",
				},
			);
		}

		const raw = readdirSync(resolved, { withFileTypes: true });

		const entries: DirEntry[] = raw
			.filter((d) => d.isDirectory() && !d.name.startsWith("."))
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((d) => {
				const fullPath = join(resolved, d.name);
				return {
					name: d.name,
					path: fullPath,
					isGitRepo: existsSync(join(fullPath, ".git")),
				};
			});

		const parentDir = dirname(resolved);
		const parent =
			(parentDir.startsWith(rootWithSep) || parentDir === this.root) &&
			parentDir !== resolved
				? parentDir
				: null;

		return { entries, parent };
	}
}
