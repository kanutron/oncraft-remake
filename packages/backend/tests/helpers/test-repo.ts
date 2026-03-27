import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";

export async function createTestRepo(): Promise<{
	path: string;
	cleanup: () => void;
}> {
	const path = mkdtempSync(join(tmpdir(), "oncraft-test-"));
	const git = simpleGit(path);
	await git.init();
	await git.addConfig("user.email", "test@test.com");
	await git.addConfig("user.name", "Test");
	writeFileSync(join(path, "README.md"), "# Test");
	await git.add(".");
	await git.commit("initial commit");
	return {
		path,
		cleanup: () => rmSync(path, { recursive: true, force: true }),
	};
}
