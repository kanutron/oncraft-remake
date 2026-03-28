import { Database } from "bun:sqlite";
import type { Session, SessionState, Repository } from "../types";

export class Store {
	private db: Database;

	constructor(dbPath = "oncraft.db") {
		this.db = new Database(dbPath);
		this.db.exec("PRAGMA journal_mode = WAL");
		this.migrate();
	}

	private migrate(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS repositories (
				id TEXT PRIMARY KEY,
				path TEXT NOT NULL UNIQUE,
				name TEXT NOT NULL,
				createdAt TEXT NOT NULL,
				lastOpenedAt TEXT NOT NULL
			)
		`);
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS sessions (
				id TEXT PRIMARY KEY,
				repositoryId TEXT NOT NULL,
				claudeSessionId TEXT,
				name TEXT NOT NULL,
				sourceBranch TEXT NOT NULL,
				workBranch TEXT,
				targetBranch TEXT NOT NULL,
				worktreePath TEXT,
				state TEXT NOT NULL DEFAULT 'idle',
				createdAt TEXT NOT NULL,
				lastActivityAt TEXT NOT NULL,
				costUsd REAL NOT NULL DEFAULT 0,
				inputTokens INTEGER NOT NULL DEFAULT 0,
				outputTokens INTEGER NOT NULL DEFAULT 0,
				FOREIGN KEY (repositoryId) REFERENCES repositories(id)
			)
		`);
	}

	// --- Repositories ---

	createRepository(repo: Repository): void {
		this.db
			.prepare(
				"INSERT INTO repositories (id, path, name, createdAt, lastOpenedAt) VALUES (?, ?, ?, ?, ?)",
			)
			.run(repo.id, repo.path, repo.name, repo.createdAt, repo.lastOpenedAt);
	}

	getRepository(id: string): Repository | null {
		return this.db
			.prepare("SELECT * FROM repositories WHERE id = ?")
			.get(id) as Repository | null;
	}

	listRepositories(): Repository[] {
		return this.db
			.prepare("SELECT * FROM repositories ORDER BY lastOpenedAt DESC")
			.all() as Repository[];
	}

	updateRepositoryLastOpened(id: string, lastOpenedAt: string): void {
		this.db
			.prepare("UPDATE repositories SET lastOpenedAt = ? WHERE id = ?")
			.run(lastOpenedAt, id);
	}

	deleteRepository(id: string): void {
		this.db.prepare("DELETE FROM repositories WHERE id = ?").run(id);
	}

	// --- Sessions ---

	createSession(s: Session): void {
		this.db
			.prepare(
				`INSERT INTO sessions (id, repositoryId, claudeSessionId, name, sourceBranch, workBranch, targetBranch,
				worktreePath, state, createdAt, lastActivityAt, costUsd, inputTokens, outputTokens)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				s.id,
				s.repositoryId,
				s.claudeSessionId,
				s.name,
				s.sourceBranch,
				s.workBranch,
				s.targetBranch,
				s.worktreePath,
				s.state,
				s.createdAt,
				s.lastActivityAt,
				s.costUsd,
				s.inputTokens,
				s.outputTokens,
			);
	}

	getSession(id: string): Session | null {
		return this.db
			.prepare("SELECT * FROM sessions WHERE id = ?")
			.get(id) as Session | null;
	}

	listSessions(repositoryId: string): Session[] {
		return this.db
			.prepare(
				"SELECT * FROM sessions WHERE repositoryId = ? ORDER BY createdAt DESC",
			)
			.all(repositoryId) as Session[];
	}

	updateSessionState(id: string, state: SessionState): void {
		this.db
			.prepare("UPDATE sessions SET state = ?, lastActivityAt = ? WHERE id = ?")
			.run(state, new Date().toISOString(), id);
	}

	updateSessionMetrics(
		id: string,
		metrics: { costUsd: number; inputTokens: number; outputTokens: number },
	): void {
		this.db
			.prepare(
				"UPDATE sessions SET costUsd = ?, inputTokens = ?, outputTokens = ? WHERE id = ?",
			)
			.run(metrics.costUsd, metrics.inputTokens, metrics.outputTokens, id);
	}

	updateClaudeSessionId(id: string, claudeSessionId: string): void {
		this.db
			.prepare("UPDATE sessions SET claudeSessionId = ? WHERE id = ?")
			.run(claudeSessionId, id);
	}

	updateSessionFields(
		id: string,
		fields: { name?: string; targetBranch?: string },
	): void {
		const sets: string[] = [];
		const values: unknown[] = [];
		if (fields.name !== undefined) {
			sets.push("name = ?");
			values.push(fields.name);
		}
		if (fields.targetBranch !== undefined) {
			sets.push("targetBranch = ?");
			values.push(fields.targetBranch);
		}
		if (sets.length === 0) return;
		values.push(id);
		this.db
			.prepare(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`)
			.run(...values);
	}

	deleteSession(id: string): void {
		this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
	}

	deleteSessionsForRepository(repositoryId: string): void {
		this.db
			.prepare("DELETE FROM sessions WHERE repositoryId = ?")
			.run(repositoryId);
	}

	close(): void {
		this.db.close();
	}
}
