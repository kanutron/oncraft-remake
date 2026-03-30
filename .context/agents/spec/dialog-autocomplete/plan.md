# Dialog Autocomplete & Smart Fields — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add path autocomplete with git detection to the Add Repository dialog, and branch autocomplete with strict/free modes to the New Session dialog.

**Architecture:** Two backend additions (FilesystemService + route) and two frontend composables (`usePathSuggestions`, `useBranchSuggestions`) wired to NuxtUI's `UInputMenu` component. No wrapper components — composables provide data, `UInputMenu` handles UX natively.

**Tech Stack:** Bun + Fastify (backend), Nuxt 4 + NuxtUI v4 `UInputMenu` (frontend), `bun:test` (testing)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `packages/backend/src/services/filesystem.service.ts` | Directory listing with git detection, root scoping |
| Create | `packages/backend/src/routes/filesystem.routes.ts` | `GET /filesystem/list-dirs` endpoint |
| Create | `packages/backend/tests/services/filesystem.service.test.ts` | Unit tests for FilesystemService |
| Create | `packages/backend/tests/routes/filesystem.routes.test.ts` | Route integration tests |
| Modify | `packages/backend/src/server.ts` | Register filesystem routes |
| Modify | `packages/backend/tests/helpers/build-app.ts` | Register filesystem routes in test app |
| Create | `packages/frontend/app/composables/usePathSuggestions.ts` | Path autocomplete data fetching + localStorage |
| Create | `packages/frontend/app/composables/useBranchSuggestions.ts` | Branch list data fetching |
| Modify | `packages/frontend/app/components/repository/RepositorySelector.vue` | UInputMenu for path, name auto-fill |
| Modify | `packages/frontend/app/components/session/NewSessionDialog.vue` | UInputMenu for branch fields |

---

### Task 1: FilesystemService

**Files:**
- Create: `packages/backend/src/services/filesystem.service.ts`
- Create: `packages/backend/tests/services/filesystem.service.test.ts`

- [ ] **Step 1: Write failing tests for FilesystemService**

```ts
// packages/backend/tests/services/filesystem.service.test.ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FilesystemService } from "../../src/services/filesystem.service";

let service: FilesystemService;
let testRoot: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "oncraft-fs-test-"));
  service = new FilesystemService(testRoot);

  // Create directory structure:
  // testRoot/
  //   project-a/          (git repo)
  //     .git/
  //   project-b/          (plain dir)
  //   .hidden/            (hidden dir)
  //   file.txt            (file, should be excluded)
  mkdirSync(join(testRoot, "project-a", ".git"), { recursive: true });
  mkdirSync(join(testRoot, "project-b"));
  mkdirSync(join(testRoot, ".hidden"));
  writeFileSync(join(testRoot, "file.txt"), "hello");
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe("FilesystemService", () => {
  test("listDirs returns only directories, sorted alphabetically", async () => {
    const result = await service.listDirs(testRoot);
    const names = result.entries.map((e) => e.name);
    expect(names).toEqual(["project-a", "project-b"]);
  });

  test("listDirs excludes hidden directories", async () => {
    const result = await service.listDirs(testRoot);
    const names = result.entries.map((e) => e.name);
    expect(names).not.toContain(".hidden");
  });

  test("listDirs excludes files", async () => {
    const result = await service.listDirs(testRoot);
    const names = result.entries.map((e) => e.name);
    expect(names).not.toContain("file.txt");
  });

  test("listDirs detects git repos", async () => {
    const result = await service.listDirs(testRoot);
    const projectA = result.entries.find((e) => e.name === "project-a");
    const projectB = result.entries.find((e) => e.name === "project-b");
    expect(projectA?.isGitRepo).toBe(true);
    expect(projectB?.isGitRepo).toBe(false);
  });

  test("listDirs returns absolute paths", async () => {
    const result = await service.listDirs(testRoot);
    for (const entry of result.entries) {
      expect(entry.path.startsWith("/")).toBe(true);
    }
  });

  test("listDirs returns parent path", async () => {
    const sub = join(testRoot, "project-b");
    mkdirSync(join(sub, "child"));
    const result = await service.listDirs(sub);
    expect(result.parent).toBe(testRoot);
  });

  test("listDirs returns null parent at root boundary", async () => {
    const result = await service.listDirs(testRoot);
    // Parent of testRoot is outside testRoot, so it should be null
    expect(result.parent).toBeNull();
  });

  test("listDirs rejects paths outside root", async () => {
    expect(service.listDirs("/etc")).rejects.toThrow("FORBIDDEN");
  });

  test("listDirs rejects nonexistent paths", async () => {
    expect(
      service.listDirs(join(testRoot, "nonexistent")),
    ).rejects.toThrow("NOT_FOUND");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/filesystem.service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement FilesystemService**

```ts
// packages/backend/src/services/filesystem.service.ts
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

  async listDirs(path: string): Promise<ListDirsResult> {
    const resolved = resolve(path);

    if (!resolved.startsWith(this.root)) {
      throw Object.assign(new Error("Path outside allowed root"), {
        code: "FORBIDDEN",
      });
    }

    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw Object.assign(new Error("Path does not exist or is not a directory"), {
        code: "NOT_FOUND",
      });
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
    const parent = parentDir.startsWith(this.root) && parentDir !== resolved
      ? parentDir
      : null;

    return { entries, parent };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/filesystem.service.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/filesystem.service.ts packages/backend/tests/services/filesystem.service.test.ts
git commit -m "feat(backend): add FilesystemService with directory listing and git detection"
```

---

### Task 2: Filesystem route

**Files:**
- Create: `packages/backend/src/routes/filesystem.routes.ts`
- Create: `packages/backend/tests/routes/filesystem.routes.test.ts`
- Modify: `packages/backend/src/server.ts`
- Modify: `packages/backend/tests/helpers/build-app.ts`

- [ ] **Step 1: Write failing route tests**

```ts
// packages/backend/tests/routes/filesystem.routes.test.ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildApp } from "../helpers/build-app";

let app: Awaited<ReturnType<typeof buildApp>>;
let testRoot: string;

beforeEach(async () => {
  testRoot = mkdtempSync(join(tmpdir(), "oncraft-fs-route-test-"));
  mkdirSync(join(testRoot, "my-repo", ".git"), { recursive: true });
  mkdirSync(join(testRoot, "plain-dir"));
  writeFileSync(join(testRoot, "file.txt"), "hello");
  app = await buildApp({ fsRoot: testRoot });
});

afterEach(async () => {
  await app.close();
  rmSync(testRoot, { recursive: true, force: true });
});

describe("Filesystem routes", () => {
  test("GET /filesystem/list-dirs returns directory entries", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/filesystem/list-dirs",
      query: { path: testRoot },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].name).toBe("my-repo");
    expect(body.entries[0].isGitRepo).toBe(true);
    expect(body.entries[1].name).toBe("plain-dir");
    expect(body.entries[1].isGitRepo).toBe(false);
  });

  test("GET /filesystem/list-dirs returns parent", async () => {
    const sub = join(testRoot, "plain-dir");
    const res = await app.inject({
      method: "GET",
      url: "/filesystem/list-dirs",
      query: { path: sub },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().parent).toBe(testRoot);
  });

  test("GET /filesystem/list-dirs returns 403 for path outside root", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/filesystem/list-dirs",
      query: { path: "/etc" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  test("GET /filesystem/list-dirs returns 404 for nonexistent path", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/filesystem/list-dirs",
      query: { path: join(testRoot, "nope") },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  test("GET /filesystem/list-dirs returns 400 when path query is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/filesystem/list-dirs",
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/routes/filesystem.routes.test.ts`
Expected: FAIL — `buildApp` doesn't accept `fsRoot` / route not registered

- [ ] **Step 3: Implement filesystem route**

```ts
// packages/backend/src/routes/filesystem.routes.ts
import type { FastifyInstance } from "fastify";
import type { FilesystemService } from "../services/filesystem.service";

export function registerFilesystemRoutes(
  app: FastifyInstance,
  filesystemService: FilesystemService,
): void {
  app.get("/filesystem/list-dirs", async (request, reply) => {
    const { path } = request.query as { path?: string };

    if (!path) {
      return reply
        .status(400)
        .send({ error: "Missing required query parameter: path", code: "BAD_REQUEST" });
    }

    try {
      return await filesystemService.listDirs(path);
    } catch (err) {
      const error = err as Error & { code?: string };
      if (error.code === "FORBIDDEN") {
        return reply.status(403).send({ error: error.message, code: "FORBIDDEN" });
      }
      if (error.code === "NOT_FOUND") {
        return reply.status(404).send({ error: error.message, code: "NOT_FOUND" });
      }
      return reply.status(500).send({ error: error.message, code: "INTERNAL" });
    }
  });
}
```

- [ ] **Step 4: Update `build-app.ts` to accept `fsRoot` and register filesystem routes**

Update `packages/backend/tests/helpers/build-app.ts` to:

```ts
// packages/backend/tests/helpers/build-app.ts
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
	);
	const sessionService = new SessionService(
		store,
		eventBus,
		gitService,
		processManager,
	);
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
```

- [ ] **Step 5: Register filesystem routes in `server.ts`**

Add these lines to `packages/backend/src/server.ts`:

After the existing import block, add:
```ts
import { registerFilesystemRoutes } from "./routes/filesystem.routes";
import { FilesystemService } from "./services/filesystem.service";
```

After the `const projectService = ...` line, add:
```ts
const filesystemService = new FilesystemService(process.env.ONCRAFT_FS_ROOT || "~");
```

After the `registerGitRoutes(...)` line, add:
```ts
registerFilesystemRoutes(app, filesystemService);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/routes/filesystem.routes.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 7: Run all existing backend tests to check for regressions**

Run: `task test:backend`
Expected: All tests PASS (existing tests call `buildApp()` without args, which still works)

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/routes/filesystem.routes.ts packages/backend/tests/routes/filesystem.routes.test.ts packages/backend/src/server.ts packages/backend/tests/helpers/build-app.ts
git commit -m "feat(backend): add filesystem list-dirs endpoint with root scoping"
```

---

### Task 3: `usePathSuggestions` composable

**Files:**
- Create: `packages/frontend/app/composables/usePathSuggestions.ts`

- [ ] **Step 1: Create the composable**

```ts
// packages/frontend/app/composables/usePathSuggestions.ts
import type { InputMenuItem } from '@nuxt/ui'

const STORAGE_KEY = 'oncraft:lastRepoParent'

export function usePathSuggestions(pathValue: Ref<string>) {
  const config = useRuntimeConfig()
  const items = ref<InputMenuItem[]>([])
  const loading = ref(false)
  const isGitRepo = ref(false)

  const lastParent = ref(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem(STORAGE_KEY) ?? ''
      : ''
  )

  let fetchController: AbortController | null = null

  function getParentAndSegment(fullPath: string): { parent: string, segment: string } {
    if (!fullPath || fullPath === '/') return { parent: '/', segment: '' }
    // If path ends with /, list that directory with no segment filter
    if (fullPath.endsWith('/')) return { parent: fullPath.slice(0, -1) || '/', segment: '' }
    // Otherwise, parent is dirname and segment is the partial name being typed
    const lastSlash = fullPath.lastIndexOf('/')
    if (lastSlash === -1) return { parent: '/', segment: fullPath }
    return {
      parent: fullPath.slice(0, lastSlash) || '/',
      segment: fullPath.slice(lastSlash + 1),
    }
  }

  const debouncedFetch = useDebounceFn(async (path: string) => {
    const { parent, segment } = getParentAndSegment(path)
    if (!parent) {
      items.value = []
      return
    }

    fetchController?.abort()
    fetchController = new AbortController()

    loading.value = true
    try {
      const data = await $fetch<{
        entries: Array<{ name: string, path: string, isGitRepo: boolean }>
        parent: string | null
      }>(`${config.public.backendUrl}/filesystem/list-dirs`, {
        query: { path: parent },
        signal: fetchController.signal,
      })

      rawEntries.value = data.entries

      const filtered = segment
        ? data.entries.filter(e => e.name.toLowerCase().startsWith(segment.toLowerCase()))
        : data.entries

      items.value = filtered.map(e => ({
        label: e.name,
        icon: e.isGitRepo ? 'i-simple-icons-git' : 'i-lucide-folder',
        value: e.path,
      }))

      // Check if current full path matches a git repo entry
      isGitRepo.value = data.entries.some(
        e => e.path === path && e.isGitRepo,
      )
    } catch {
      items.value = []
      isGitRepo.value = false
    } finally {
      loading.value = false
    }
  }, 200)

  watch(pathValue, (val) => {
    if (val) {
      debouncedFetch(val)
    } else {
      items.value = []
      isGitRepo.value = false
    }
  })

  // Raw entries from last fetch — used to resolve selections
  const rawEntries = ref<Array<{ name: string, path: string, isGitRepo: boolean }>>([])

  function saveLastParent(repoPath: string) {
    const lastSlash = repoPath.lastIndexOf('/')
    const parent = lastSlash > 0 ? repoPath.slice(0, lastSlash) : '/'
    lastParent.value = parent
    localStorage.setItem(STORAGE_KEY, parent)
  }

  /** If val matches a known entry path, return it with trailing slash. Otherwise null. */
  function resolveSelection(val: string): string | null {
    const match = rawEntries.value.find(e => e.path === val)
    return match ? match.path + '/' : null
  }

  return { items, loading, isGitRepo, lastParent, saveLastParent, resolveSelection }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `task dev:frontend`
Expected: No TypeScript compilation errors in the terminal output. Stop the dev server after checking.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/app/composables/usePathSuggestions.ts
git commit -m "feat(frontend): add usePathSuggestions composable for path autocomplete"
```

---

### Task 4: `useBranchSuggestions` composable

**Files:**
- Create: `packages/frontend/app/composables/useBranchSuggestions.ts`

- [ ] **Step 1: Create the composable**

```ts
// packages/frontend/app/composables/useBranchSuggestions.ts
import type { InputMenuItem } from '@nuxt/ui'

export function useBranchSuggestions(repositoryId: Ref<string>) {
  const config = useRuntimeConfig()
  const items = ref<InputMenuItem[]>([])
  const loading = ref(false)

  async function refresh() {
    if (!repositoryId.value) {
      items.value = []
      return
    }

    loading.value = true
    try {
      const data = await $fetch<{
        all: string[]
        current: string
      }>(`${config.public.backendUrl}/repositories/${repositoryId.value}/git/branches`)

      items.value = data.all.map(branch => ({
        label: branch,
        icon: 'i-lucide-git-branch',
        chip: branch === data.current
          ? { color: 'primary' as const, label: 'HEAD', size: 'xs' as const }
          : undefined,
      }))
    } catch {
      items.value = []
    } finally {
      loading.value = false
    }
  }

  watch(repositoryId, () => refresh(), { immediate: true })

  return { items, loading, refresh }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `task dev:frontend`
Expected: No TypeScript compilation errors. Stop the dev server after checking.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/app/composables/useBranchSuggestions.ts
git commit -m "feat(frontend): add useBranchSuggestions composable for branch autocomplete"
```

---

### Task 5: Update RepositorySelector.vue

**Files:**
- Modify: `packages/frontend/app/components/repository/RepositorySelector.vue`

- [ ] **Step 1: Update the component**

Replace the full content of `packages/frontend/app/components/repository/RepositorySelector.vue` with:

```vue
<script setup lang="ts">
const props = withDefaults(defineProps<{
  /** When true, renders inside a UModal. When false, renders the form inline. */
  modal?: boolean
}>(), {
  modal: true,
})

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  close: []
}>()

const repositoryStore = useRepositoryStore()

const path = ref('')
const name = ref('')
const loading = ref(false)
const nameManuallyEdited = ref(false)

const { items: pathItems, loading: pathLoading, isGitRepo, lastParent, saveLastParent, resolveSelection } = usePathSuggestions(path)

const pathIcon = computed(() => isGitRepo.value ? 'i-simple-icons-git' : 'i-lucide-folder')

// Auto-fill name from last path segment
watch(path, (val) => {
  if (nameManuallyEdited.value) return
  const segments = val.split('/').filter(Boolean)
  name.value = segments.length > 0 ? segments[segments.length - 1] : ''
})

// Pre-fill path with last used parent when dialog opens
watch(open, (isOpen) => {
  if (isOpen && lastParent.value && !path.value) {
    path.value = lastParent.value + '/'
  }
})

function onNameInput() {
  nameManuallyEdited.value = true
}

// Handle path input updates — when user selects from dropdown, append trailing /
function onPathUpdate(val: string) {
  const resolved = resolveSelection(val)
  path.value = resolved ?? val
}

async function submit() {
  if (!path.value.trim()) return

  loading.value = true
  try {
    await repositoryStore.open(path.value.trim(), name.value.trim() || undefined)
    saveLastParent(path.value.trim())
    path.value = ''
    name.value = ''
    nameManuallyEdited.value = false
    open.value = false
    emit('close')
  } finally {
    loading.value = false
  }
}

function cancel() {
  open.value = false
  emit('close')
}
</script>

<template>
  <!-- Modal mode: triggered from RepositoryTabBar -->
  <UModal
    v-if="modal"
    v-model:open="open"
    title="Add Repository"
    description="Add a git repository to this project."
  >
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Repository path</label>
          <UInputMenu
            :model-value="path"
            autocomplete
            :items="pathItems"
            :loading="pathLoading"
            :icon="pathIcon"
            ignore-filter
            value-key="value"
            placeholder="/path/to/repository"
            autofocus
            :content="{ hideWhenEmpty: true }"
            @update:model-value="onPathUpdate"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Name (optional)</label>
          <UInput
            v-model="name"
            placeholder="Display name"
            icon="i-lucide-tag"
            @input="onNameInput"
          />
        </div>

        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="cancel"
          />
          <UButton
            label="Add"
            type="submit"
            :loading="loading"
            :disabled="!path.trim()"
          />
        </div>
      </form>
    </template>
  </UModal>

  <!-- Inline mode: empty state when no repositories are open -->
  <div v-else class="w-full max-w-md p-6">
    <h2 class="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
      Add Repository
    </h2>
    <p class="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
      Add a git repository to get started.
    </p>

    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Repository path</label>
        <UInputMenu
          v-model="path"
          autocomplete
          :items="pathItems"
          :loading="pathLoading"
          :icon="pathIcon"
          ignore-filter
          value-key="value"
          placeholder="/path/to/repository"
          autofocus
          :content="{ hideWhenEmpty: true }"
          @update:model-value="onPathSelect"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Name (optional)</label>
        <UInput
          v-model="name"
          placeholder="Display name"
          icon="i-lucide-tag"
          @input="onNameInput"
        />
      </div>

      <div class="flex justify-end">
        <UButton
          label="Add Repository"
          type="submit"
          :loading="loading"
          :disabled="!path.trim()"
        />
      </div>
    </form>
  </div>
</template>
```

- [ ] **Step 2: Smoke test in the browser**

Run: `task dev`
Steps:
1. Open the app at `http://localhost:3100`
2. Click "Add Repository" to open the dialog
3. Start typing a path — verify the dropdown appears with directory suggestions
4. Verify git repos show the git icon, plain dirs show the folder icon
5. Select a directory — verify the name field auto-fills with the directory name
6. Close and re-open the dialog — verify the last-used parent is pre-filled

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/app/components/repository/RepositorySelector.vue
git commit -m "feat(frontend): upgrade repository path field to autocomplete with git detection"
```

---

### Task 6: Update NewSessionDialog.vue

**Files:**
- Modify: `packages/frontend/app/components/session/NewSessionDialog.vue`

- [ ] **Step 1: Update the component**

Replace the full content of `packages/frontend/app/components/session/NewSessionDialog.vue` with:

```vue
<script setup lang="ts">
const props = defineProps<{
  repositoryId: string
}>()

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  close: []
}>()

const sessionStore = useSessionStore()

const name = ref('')
const sourceBranch = ref('')
const targetBranch = ref('')
const workIsolated = ref(false)
const workBranch = ref('')
const loading = ref(false)
const error = ref('')

const repositoryIdRef = computed(() => props.repositoryId)
const { items: branchItems, loading: branchLoading } = useBranchSuggestions(repositoryIdRef)

// Pre-select HEAD branch as source when branches load
watch(branchItems, (items) => {
  if (!sourceBranch.value && items.length > 0) {
    const head = items.find(i => i.chip)
    if (head) {
      sourceBranch.value = head.label ?? ''
    }
  }
})

const isValid = computed(() => {
  if (!name.value.trim() || !sourceBranch.value.trim()) return false
  if (workIsolated.value && !workBranch.value.trim()) return false
  return true
})

async function submit() {
  if (!isValid.value) return

  loading.value = true
  error.value = ''
  try {
    await sessionStore.create(props.repositoryId, {
      name: name.value.trim(),
      sourceBranch: sourceBranch.value.trim(),
      workBranch: workIsolated.value ? workBranch.value.trim() : undefined,
      targetBranch: targetBranch.value.trim() || undefined,
    })
    name.value = ''
    sourceBranch.value = ''
    targetBranch.value = ''
    workIsolated.value = false
    workBranch.value = ''
    open.value = false
    emit('close')
  } catch (err: unknown) {
    const msg = (err as { data?: { error?: string } })?.data?.error
    error.value = msg || 'Failed to create session'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="New Session"
    description="Create a new Claude Code session in this repository."
  >
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          :title="error"
          icon="i-lucide-alert-circle"
        />

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Session name</label>
          <UInput
            v-model="name"
            placeholder="feat/my-feature"
            icon="i-lucide-terminal"
            autofocus
            required
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Source branch</label>
          <UInputMenu
            v-model="sourceBranch"
            :items="branchItems"
            :loading="branchLoading"
            icon="i-lucide-git-branch"
            placeholder="main"
            value-key="label"
          />
          <span class="text-xs text-neutral-400 dark:text-neutral-500">Starting point for this session (HEAD)</span>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Target branch</label>
          <UInputMenu
            v-model="targetBranch"
            :items="branchItems"
            :loading="branchLoading"
            icon="i-lucide-git-merge"
            :placeholder="sourceBranch || 'defaults to source'"
            value-key="label"
            :create-item="{ position: 'bottom', when: 'always' }"
          />
          <span class="text-xs text-neutral-400 dark:text-neutral-500">Where work should merge or PR to</span>
        </div>

        <USwitch
          v-model="workIsolated"
          label="Work isolated"
          description="Create a dedicated worktree with its own branch."
        />

        <template v-if="workIsolated">
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Work branch</label>
            <UInputMenu
              v-model="workBranch"
              :items="branchItems"
              :loading="branchLoading"
              icon="i-lucide-git-fork"
              placeholder="feat/my-feature"
              value-key="label"
              :create-item="{ position: 'bottom', when: 'always' }"
            />
            <span class="text-xs text-neutral-400 dark:text-neutral-500">Branch for this session's commits (created if it doesn't exist)</span>
          </div>

          <UAlert
            color="info"
            variant="subtle"
            icon="i-lucide-folder-tree"
            :title="`A worktree will be created for branch ${workBranch || '...'}`"
          />
        </template>

        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="open = false; emit('close')"
          />
          <UButton
            label="Create"
            type="submit"
            :loading="loading"
            :disabled="!isValid"
          />
        </div>
      </form>
    </template>
  </UModal>
</template>
```

- [ ] **Step 2: Smoke test in the browser**

Run: `task dev`
Steps:
1. Open the app at `http://localhost:3100`
2. Add a repository (if none exists)
3. Click "New Session" to open the dialog
4. Verify source branch field shows existing branches in dropdown and pre-selects HEAD
5. Verify source branch only allows picking from the list (no free text accepted)
6. Verify target branch shows existing branches AND allows typing a new branch name (shows "Create ..." option)
7. Toggle "Work isolated" and verify work branch field appears with same behavior as target branch
8. Fill all fields and create a session — verify it works

- [ ] **Step 3: Run all tests**

Run: `task test:all`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/app/components/session/NewSessionDialog.vue
git commit -m "feat(frontend): upgrade session branch fields to autocomplete with strict/free modes"
```

---

### Task 7: Final lint check and cleanup

- [ ] **Step 1: Run linter**

Run: `task lint:check`
Expected: Zero errors. Fix any issues that arise.

- [ ] **Step 2: Run full test suite**

Run: `task test:all`
Expected: All tests PASS.

- [ ] **Step 3: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: fix lint issues from dialog autocomplete feature"
```

(Skip this step if no lint fixes were needed.)
