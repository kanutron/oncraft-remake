# Chat Session Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist all chat-session prompt controls on the Session record; add missing Permission-mode and Thinking controls to the toolbar; make the model / effort / permission-mode lists future-proof against SDK updates; fix the bridge bug that drops `effort`.

**Architecture:** Server-owned capabilities module exposed via `GET /sdk/capabilities`; additive SQLite migration adds five preference columns to `sessions`; new `PATCH /sessions/:id/preferences` endpoint + debounced toolbar writes; existing `POST /send` also persists inbound prefs as defense-in-depth; bridge forwards the full option set including `thinking` config.

**Tech Stack:** Bun + Fastify + bun:sqlite (backend), Nuxt 4 + Vue 3 + Pinia + NuxtUI v4 (frontend), `@anthropic-ai/claude-agent-sdk@0.2.114`, Vitest (frontend tests), `bun test` (backend tests).

---

## File Structure

**Create**

- `packages/backend/src/constants/sdk-capabilities.ts` — authoritative lists of models / effort / permission modes / thinking modes.
- `packages/backend/src/routes/capabilities.routes.ts` — `GET /sdk/capabilities`.
- `packages/backend/tests/constants/sdk-capabilities.test.ts` — drift / shape test.
- `packages/backend/tests/routes/capabilities.routes.test.ts` — route test.
- `packages/frontend/app/stores/capabilities.store.ts` — Pinia store, fetch-once cache.
- `packages/frontend/tests/stores/capabilities.store.test.ts`.

**Modify**

- `packages/backend/src/types/index.ts` — add 5 preference fields to `Session`.
- `packages/backend/src/infra/store.ts` — migration + `updateSessionPreferences`.
- `packages/backend/src/services/session.service.ts` — accept prefs, persist, forward to bridge.
- `packages/backend/src/routes/session.routes.ts` — extend `/send`, add `PATCH /preferences`.
- `packages/backend/src/bridge/session-bridge.ts` — forward `effort`, `thinking`, `fallbackModel`.
- `packages/backend/src/index.ts` (or wherever routes register) — register capabilities route.
- `packages/backend/tests/infra/store.test.ts` — extend for new columns.
- `packages/backend/tests/services/session.service.test.ts` — extend for prefs.
- `packages/backend/tests/routes/session.routes.test.ts` — extend for PATCH + extended send.
- `packages/backend/tests/bridge/session-bridge.test.ts` — assert SDK option wiring.
- `packages/frontend/app/types/index.ts` — mirror new Session fields.
- `packages/frontend/app/components/prompt/PromptToolbar.vue` — full overhaul.
- `packages/frontend/app/components/prompt/PromptBox.vue` — read toolbar values from session prefs.
- `packages/frontend/app/stores/session.store.ts` — `updatePreferences(sessionId, prefs)`.
- `packages/frontend/tests/stores/session.store.test.ts` — extend.

---

## Task 1: Backend — SDK capabilities constants module

**Files:**
- Create: `packages/backend/src/constants/sdk-capabilities.ts`
- Create: `packages/backend/tests/constants/sdk-capabilities.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/backend/tests/constants/sdk-capabilities.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import {
  MODELS,
  EFFORT_LEVELS,
  PERMISSION_MODES,
  THINKING_MODES,
  DEFAULT_THINKING_BUDGET,
} from "../../src/constants/sdk-capabilities";

describe("sdk-capabilities", () => {
  it("exposes the current SDK model aliases", () => {
    expect(MODELS.map(m => m.value)).toEqual(["sonnet", "opus", "haiku"]);
  });

  it("exposes all five SDK effort levels", () => {
    expect(EFFORT_LEVELS.map(e => e.value)).toEqual([
      "low", "medium", "high", "xhigh", "max",
    ]);
  });

  it("restricts xhigh and max to opus", () => {
    const xhigh = EFFORT_LEVELS.find(e => e.value === "xhigh");
    const max   = EFFORT_LEVELS.find(e => e.value === "max");
    expect(xhigh?.supportedModels).toEqual(["opus"]);
    expect(max?.supportedModels).toEqual(["opus"]);
  });

  it("exposes all SDK permission modes with bypass flagged dangerous", () => {
    expect(PERMISSION_MODES.map(p => p.value).sort()).toEqual([
      "acceptEdits", "auto", "bypassPermissions", "default", "dontAsk", "plan",
    ]);
    const bypass = PERMISSION_MODES.find(p => p.value === "bypassPermissions");
    expect(bypass?.dangerous).toBe(true);
  });

  it("exposes three thinking modes and a positive default budget", () => {
    expect(THINKING_MODES.map(t => t.value)).toEqual([
      "off", "adaptive", "fixed",
    ]);
    expect(DEFAULT_THINKING_BUDGET).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test:backend -- tests/constants/sdk-capabilities.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

`packages/backend/src/constants/sdk-capabilities.ts`:

```ts
export interface CapabilityOption<V extends string = string> {
  value: V;
  label: string;
  /** Models for which this value is valid. Omit = valid for all. */
  supportedModels?: ReadonlyArray<string>;
  /** UX hint: render with danger styling. */
  dangerous?: boolean;
}

export const MODELS = [
  { value: "sonnet", label: "Sonnet" },
  { value: "opus",   label: "Opus" },
  { value: "haiku",  label: "Haiku" },
] as const satisfies ReadonlyArray<CapabilityOption>;

export const EFFORT_LEVELS = [
  { value: "low",    label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high",   label: "High" },
  { value: "xhigh",  label: "X-High", supportedModels: ["opus"] },
  { value: "max",    label: "Max",    supportedModels: ["opus"] },
] as const satisfies ReadonlyArray<CapabilityOption>;

export const PERMISSION_MODES = [
  { value: "default",           label: "Ask first" },
  { value: "plan",              label: "Plan" },
  { value: "acceptEdits",       label: "Accept edits" },
  { value: "auto",              label: "Auto" },
  { value: "dontAsk",           label: "Don't ask" },
  { value: "bypassPermissions", label: "Bypass", dangerous: true },
] as const satisfies ReadonlyArray<CapabilityOption>;

export const THINKING_MODES = [
  { value: "off",      label: "Off" },
  { value: "adaptive", label: "Adaptive" },
  { value: "fixed",    label: "Fixed budget" },
] as const satisfies ReadonlyArray<CapabilityOption>;

export const DEFAULT_THINKING_BUDGET = 8000;

export type ThinkingMode = (typeof THINKING_MODES)[number]["value"];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test:backend -- tests/constants/sdk-capabilities.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/constants/sdk-capabilities.ts \
        packages/backend/tests/constants/sdk-capabilities.test.ts
git commit -m "feat(backend): add sdk-capabilities constants module"
```

---

## Task 2: Backend — GET /sdk/capabilities route

**Files:**
- Create: `packages/backend/src/routes/capabilities.routes.ts`
- Create: `packages/backend/tests/routes/capabilities.routes.test.ts`
- Modify: `packages/backend/src/index.ts` (route registration — locate via `registerSessionRoutes` call)

- [ ] **Step 1: Write the failing test**

`packages/backend/tests/routes/capabilities.routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { registerCapabilitiesRoutes } from "../../src/routes/capabilities.routes";

describe("GET /sdk/capabilities", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    registerCapabilitiesRoutes(app);
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  it("returns models, effort levels, permission modes, thinking modes, default budget", async () => {
    const res = await app.inject({ method: "GET", url: "/sdk/capabilities" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("models");
    expect(body).toHaveProperty("effortLevels");
    expect(body).toHaveProperty("permissionModes");
    expect(body).toHaveProperty("thinkingModes");
    expect(body.defaultThinkingBudget).toBeGreaterThan(0);
    expect(body.effortLevels.some((e: any) => e.value === "xhigh")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test:backend -- tests/routes/capabilities.routes.test.ts`
Expected: FAIL — `registerCapabilitiesRoutes` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/backend/src/routes/capabilities.routes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import {
  MODELS,
  EFFORT_LEVELS,
  PERMISSION_MODES,
  THINKING_MODES,
  DEFAULT_THINKING_BUDGET,
} from "../constants/sdk-capabilities";

export function registerCapabilitiesRoutes(app: FastifyInstance): void {
  app.get("/sdk/capabilities", async () => ({
    models: MODELS,
    effortLevels: EFFORT_LEVELS,
    permissionModes: PERMISSION_MODES,
    thinkingModes: THINKING_MODES,
    defaultThinkingBudget: DEFAULT_THINKING_BUDGET,
  }));
}
```

- [ ] **Step 4: Wire into the main app**

Locate the place in `packages/backend/src/index.ts` where other routes are registered (look for `registerSessionRoutes(app, …)`). Add alongside it:

```ts
import { registerCapabilitiesRoutes } from "./routes/capabilities.routes";
// …
registerCapabilitiesRoutes(app);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `task test:backend -- tests/routes/capabilities.routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/routes/capabilities.routes.ts \
        packages/backend/tests/routes/capabilities.routes.test.ts \
        packages/backend/src/index.ts
git commit -m "feat(backend): expose GET /sdk/capabilities"
```

---

## Task 3: Backend — Session type + migration

**Files:**
- Modify: `packages/backend/src/types/index.ts`
- Modify: `packages/backend/src/infra/store.ts`
- Modify: `packages/backend/tests/infra/store.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/backend/tests/infra/store.test.ts`:

```ts
describe("session preferences columns", () => {
  it("defaults preference columns to null for a fresh session", () => {
    const store = new Store(":memory:");
    const repoId = crypto.randomUUID();
    store.createRepository({
      id: repoId, path: "/tmp/x", name: "x",
      createdAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString(),
    });
    const sessionId = crypto.randomUUID();
    store.createSession({
      id: sessionId, repositoryId: repoId, claudeSessionId: null,
      name: "s", sourceBranch: "main", workBranch: null, targetBranch: "main",
      worktreePath: null, state: "idle",
      createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(),
      costUsd: 0, inputTokens: 0, outputTokens: 0,
      preferredModel: null, preferredEffort: null, preferredPermissionMode: null,
      thinkingMode: null, thinkingBudget: null,
    });
    const got = store.getSession(sessionId)!;
    expect(got.preferredModel).toBeNull();
    expect(got.preferredEffort).toBeNull();
    expect(got.preferredPermissionMode).toBeNull();
    expect(got.thinkingMode).toBeNull();
    expect(got.thinkingBudget).toBeNull();
  });

  it("persists preference fields via updateSessionPreferences", () => {
    const store = new Store(":memory:");
    const repoId = crypto.randomUUID();
    store.createRepository({
      id: repoId, path: "/tmp/y", name: "y",
      createdAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString(),
    });
    const sessionId = crypto.randomUUID();
    store.createSession({
      id: sessionId, repositoryId: repoId, claudeSessionId: null,
      name: "s", sourceBranch: "main", workBranch: null, targetBranch: "main",
      worktreePath: null, state: "idle",
      createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(),
      costUsd: 0, inputTokens: 0, outputTokens: 0,
      preferredModel: null, preferredEffort: null, preferredPermissionMode: null,
      thinkingMode: null, thinkingBudget: null,
    });
    store.updateSessionPreferences(sessionId, {
      preferredModel: "opus",
      preferredEffort: "high",
      preferredPermissionMode: "acceptEdits",
      thinkingMode: "fixed",
      thinkingBudget: 12000,
    });
    const got = store.getSession(sessionId)!;
    expect(got.preferredModel).toBe("opus");
    expect(got.preferredEffort).toBe("high");
    expect(got.preferredPermissionMode).toBe("acceptEdits");
    expect(got.thinkingMode).toBe("fixed");
    expect(got.thinkingBudget).toBe(12000);
  });
});
```

- [ ] **Step 2: Run to verify the tests fail**

Run: `task test:backend -- tests/infra/store.test.ts`
Expected: FAIL — unknown fields / method not found.

- [ ] **Step 3: Extend the Session type**

In `packages/backend/src/types/index.ts`, append the five fields inside `Session`:

```ts
export interface Session {
  id: string;
  repositoryId: string;
  claudeSessionId: string | null;
  name: string;
  sourceBranch: string;
  workBranch: string | null;
  targetBranch: string;
  worktreePath: string | null;
  state: SessionState;
  createdAt: string;
  lastActivityAt: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  preferredModel: string | null;
  preferredEffort: string | null;
  preferredPermissionMode: string | null;
  thinkingMode: "off" | "adaptive" | "fixed" | null;
  thinkingBudget: number | null;
}
```

- [ ] **Step 4: Extend the store migration + writers**

In `packages/backend/src/infra/store.ts`:

1. Replace the `sessions` `CREATE TABLE IF NOT EXISTS` block with the extended schema:

```ts
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
    preferredModel TEXT,
    preferredEffort TEXT,
    preferredPermissionMode TEXT,
    thinkingMode TEXT,
    thinkingBudget INTEGER,
    FOREIGN KEY (repositoryId) REFERENCES repositories(id)
  )
`);
```

2. Immediately after the `CREATE TABLE`, add the additive-migration guard so existing DBs get the new columns:

```ts
const columns = this.db
  .prepare(`PRAGMA table_info(sessions)`)
  .all() as Array<{ name: string }>;
const have = new Set(columns.map(c => c.name));
const add = (col: string, def: string) => {
  if (!have.has(col)) {
    this.db.exec(`ALTER TABLE sessions ADD COLUMN ${col} ${def}`);
  }
};
add("preferredModel",            "TEXT");
add("preferredEffort",           "TEXT");
add("preferredPermissionMode",   "TEXT");
add("thinkingMode",              "TEXT");
add("thinkingBudget",            "INTEGER");
```

3. Extend `createSession` to write the five columns (values come from the `Session` object):

```ts
createSession(s: Session): void {
  this.db
    .prepare(
      `INSERT INTO sessions (id, repositoryId, claudeSessionId, name, sourceBranch, workBranch, targetBranch,
      worktreePath, state, createdAt, lastActivityAt, costUsd, inputTokens, outputTokens,
      preferredModel, preferredEffort, preferredPermissionMode, thinkingMode, thinkingBudget)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      s.id, s.repositoryId, s.claudeSessionId, s.name, s.sourceBranch,
      s.workBranch, s.targetBranch, s.worktreePath, s.state,
      s.createdAt, s.lastActivityAt, s.costUsd, s.inputTokens, s.outputTokens,
      s.preferredModel, s.preferredEffort, s.preferredPermissionMode,
      s.thinkingMode, s.thinkingBudget,
    );
}
```

4. Add the preference writer below `updateSessionFields`:

```ts
updateSessionPreferences(
  id: string,
  prefs: {
    preferredModel?: string | null;
    preferredEffort?: string | null;
    preferredPermissionMode?: string | null;
    thinkingMode?: "off" | "adaptive" | "fixed" | null;
    thinkingBudget?: number | null;
  },
): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  const keys = [
    "preferredModel", "preferredEffort", "preferredPermissionMode",
    "thinkingMode", "thinkingBudget",
  ] as const;
  for (const k of keys) {
    if (prefs[k] !== undefined) {
      sets.push(`${k} = ?`);
      values.push(prefs[k]);
    }
  }
  if (sets.length === 0) return;
  values.push(id);
  this.db
    .prepare(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`)
    .run(...values);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `task test:backend -- tests/infra/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/types/index.ts \
        packages/backend/src/infra/store.ts \
        packages/backend/tests/infra/store.test.ts
git commit -m "feat(backend): persist session preference columns"
```

---

## Task 4: Backend — Session creation hydrates new fields

**Files:**
- Modify: `packages/backend/src/services/session.service.ts`

The existing `SessionService.create()` builds a `Session` object without the five new fields, which will now fail the type. Fix it.

- [ ] **Step 1: Add the fields to the object literal**

In `packages/backend/src/services/session.service.ts`, inside `async create(...)`, extend the `session: Session` literal so it includes:

```ts
preferredModel: null,
preferredEffort: null,
preferredPermissionMode: null,
thinkingMode: null,
thinkingBudget: null,
```

- [ ] **Step 2: Run type check + existing service tests**

Run: `task lint:check`
Expected: zero errors on `session.service.ts`.

Run: `task test:backend -- tests/services/session.service.test.ts`
Expected: pre-existing tests still PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/session.service.ts
git commit -m "fix(backend): initialize session preferences to null on create"
```

---

## Task 5: Backend — SessionService.send persists + forwards preferences

**Files:**
- Modify: `packages/backend/src/services/session.service.ts`
- Modify: `packages/backend/tests/services/session.service.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/backend/tests/services/session.service.test.ts` (reuse existing mocks; follow the file's existing test harness pattern — read the top of the file first and mirror the fixture setup):

```ts
describe("send() — preferences", () => {
  it("persists prefs in body before forwarding to the bridge", async () => {
    const { service, store, processManager } = makeFixture();
    const session = await service.create(repoId, { name: "t", sourceBranch: "main" });
    await service.send(session.id, "hi", {
      model: "opus",
      effort: "xhigh",
      permissionMode: "plan",
      thinkingMode: "fixed",
      thinkingBudget: 12000,
    });
    const stored = store.getSession(session.id)!;
    expect(stored.preferredModel).toBe("opus");
    expect(stored.preferredEffort).toBe("xhigh");
    expect(stored.preferredPermissionMode).toBe("plan");
    expect(stored.thinkingMode).toBe("fixed");
    expect(stored.thinkingBudget).toBe(12000);
    const last = processManager.sent.at(-1);
    expect(last).toMatchObject({
      cmd: "start",
      model: "opus",
      effort: "xhigh",
      permissionMode: "plan",
      thinkingMode: "fixed",
      thinkingBudget: 12000,
    });
  });

  it("falls back to stored prefs when body is empty", async () => {
    const { service, store, processManager } = makeFixture();
    const session = await service.create(repoId, { name: "t", sourceBranch: "main" });
    store.updateSessionPreferences(session.id, {
      preferredModel: "haiku", preferredEffort: "low",
    });
    await service.send(session.id, "hi", {});
    const last = processManager.sent.at(-1);
    expect(last).toMatchObject({ model: "haiku", effort: "low" });
  });
});
```

> If the existing file lacks a `makeFixture()` helper, define one at the top of the new `describe` block that builds `Store`, `EventBus`, a stub `ProcessManager` that records `send` calls in a `sent: any[]` array, and wires them into `SessionService`. Do **not** copy-and-paste a large block from elsewhere — factor a helper.

- [ ] **Step 2: Run to verify it fails**

Run: `task test:backend -- tests/services/session.service.test.ts`
Expected: FAIL (unknown options `thinkingMode` / `thinkingBudget`, or prefs not stored).

- [ ] **Step 3: Extend SendOptions and the send method**

In `packages/backend/src/services/session.service.ts`:

Replace `SendOptions`:

```ts
interface SendOptions {
  model?: string;
  effort?: string;
  permissionMode?: string;
  thinkingMode?: "off" | "adaptive" | "fixed";
  thinkingBudget?: number;
  fallbackModel?: string;
}
```

Replace the body of `async send(sessionId, message, opts)` after the `this.setState(sessionId, "active")` line:

```ts
const hasPrefsInBody =
  opts.model !== undefined ||
  opts.effort !== undefined ||
  opts.permissionMode !== undefined ||
  opts.thinkingMode !== undefined ||
  opts.thinkingBudget !== undefined;

if (hasPrefsInBody) {
  this.store.updateSessionPreferences(sessionId, {
    preferredModel: opts.model ?? null,
    preferredEffort: opts.effort ?? null,
    preferredPermissionMode: opts.permissionMode ?? null,
    thinkingMode: opts.thinkingMode ?? null,
    thinkingBudget: opts.thinkingBudget ?? null,
  });
}

const stored = this.store.getSession(sessionId)!;

this.processManager.send(sessionId, {
  cmd: "start",
  projectPath: cwd,
  prompt: message,
  sessionId: session.claudeSessionId ?? undefined,
  model: opts.model ?? stored.preferredModel ?? undefined,
  effort: opts.effort ?? stored.preferredEffort ?? undefined,
  permissionMode: opts.permissionMode ?? stored.preferredPermissionMode ?? undefined,
  thinkingMode: opts.thinkingMode ?? stored.thinkingMode ?? undefined,
  thinkingBudget: opts.thinkingBudget ?? stored.thinkingBudget ?? undefined,
  fallbackModel: opts.fallbackModel,
});
```

> Guard pattern: `??` collapses `null`/`undefined` to `undefined` so absent keys are not serialized, matching the bridge's guard on the other side.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test:backend -- tests/services/session.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/session.service.ts \
        packages/backend/tests/services/session.service.test.ts
git commit -m "feat(backend): persist and forward full preference set on send"
```

---

## Task 6: Backend — PATCH /sessions/:id/preferences + extended /send body

**Files:**
- Modify: `packages/backend/src/routes/session.routes.ts`
- Modify: `packages/backend/tests/routes/session.routes.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/backend/tests/routes/session.routes.test.ts` (follow the file's existing fixture setup):

```ts
describe("PATCH /sessions/:id/preferences", () => {
  it("persists a partial preference update", async () => {
    const { app, sessionService, store } = await makeFixture();
    const session = await sessionService.create(repoId, { name: "t", sourceBranch: "main" });
    const res = await app.inject({
      method: "PATCH",
      url: `/sessions/${session.id}/preferences`,
      payload: { preferredModel: "opus", thinkingMode: "adaptive" },
    });
    expect(res.statusCode).toBe(200);
    const stored = store.getSession(session.id)!;
    expect(stored.preferredModel).toBe("opus");
    expect(stored.thinkingMode).toBe("adaptive");
    expect(stored.preferredEffort).toBeNull();
  });

  it("returns 404 for unknown session", async () => {
    const { app } = await makeFixture();
    const res = await app.inject({
      method: "PATCH",
      url: `/sessions/${crypto.randomUUID()}/preferences`,
      payload: { preferredModel: "opus" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /sessions/:id/send — extended body", () => {
  it("accepts thinkingMode and thinkingBudget", async () => {
    const { app, sessionService } = await makeFixture();
    const session = await sessionService.create(repoId, { name: "t", sourceBranch: "main" });
    const res = await app.inject({
      method: "POST",
      url: `/sessions/${session.id}/send`,
      payload: {
        message: "hi",
        model: "opus",
        effort: "max",
        thinkingMode: "fixed",
        thinkingBudget: 9000,
      },
    });
    expect(res.statusCode).toBe(202);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `task test:backend -- tests/routes/session.routes.test.ts`
Expected: FAIL — route not registered / payload fields rejected.

- [ ] **Step 3: Implement the route changes**

In `packages/backend/src/routes/session.routes.ts`:

Replace the `/sessions/:id/send` handler body-destructure with:

```ts
const {
  message, model, effort, permissionMode,
  thinkingMode, thinkingBudget,
} = request.body as {
  message: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  thinkingMode?: "off" | "adaptive" | "fixed";
  thinkingBudget?: number;
};
```

And pass the new fields into `sessionService.send`:

```ts
await sessionService.send(id, message, {
  model, effort, permissionMode, thinkingMode, thinkingBudget,
});
```

Add a new handler (before the `reply` handler):

```ts
app.patch("/sessions/:id/preferences", async (request, reply) => {
  const { id } = request.params as { id: string };
  const session = sessionService.get(id);
  if (!session) {
    return reply.status(404).send({ error: "Session not found", code: "NOT_FOUND" });
  }
  const body = request.body as {
    preferredModel?: string | null;
    preferredEffort?: string | null;
    preferredPermissionMode?: string | null;
    thinkingMode?: "off" | "adaptive" | "fixed" | null;
    thinkingBudget?: number | null;
  };
  sessionService.updatePreferences(id, body);
  return sessionService.get(id);
});
```

In `packages/backend/src/services/session.service.ts`, add:

```ts
updatePreferences(
  id: string,
  prefs: {
    preferredModel?: string | null;
    preferredEffort?: string | null;
    preferredPermissionMode?: string | null;
    thinkingMode?: "off" | "adaptive" | "fixed" | null;
    thinkingBudget?: number | null;
  },
): void {
  this.store.updateSessionPreferences(id, prefs);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `task test:backend -- tests/routes/session.routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/routes/session.routes.ts \
        packages/backend/src/services/session.service.ts \
        packages/backend/tests/routes/session.routes.test.ts
git commit -m "feat(backend): add PATCH /sessions/:id/preferences and extend /send body"
```

---

## Task 7: Backend — Bridge forwards effort / thinking / fallbackModel

**Files:**
- Modify: `packages/backend/src/bridge/session-bridge.ts`
- Modify: `packages/backend/tests/bridge/session-bridge.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/backend/tests/bridge/session-bridge.test.ts` (inspect the file to learn its existing harness — typically it spawns or invokes the bridge's `handleStart` directly with a stubbed SDK module):

```ts
describe("bridge — SDK options wiring", () => {
  it("forwards model, effort, permissionMode, fallbackModel, and adaptive thinking", async () => {
    const capturedOptions = await runStartAndCaptureOptions({
      cmd: "start", projectPath: "/tmp", prompt: "hi",
      model: "opus", effort: "xhigh", permissionMode: "plan",
      fallbackModel: "sonnet", thinkingMode: "adaptive",
    });
    expect(capturedOptions.model).toBe("opus");
    expect(capturedOptions.effort).toBe("xhigh");
    expect(capturedOptions.permissionMode).toBe("plan");
    expect(capturedOptions.fallbackModel).toBe("sonnet");
    expect(capturedOptions.thinking).toEqual({ type: "adaptive" });
  });

  it("encodes fixed thinking with budgetTokens", async () => {
    const capturedOptions = await runStartAndCaptureOptions({
      cmd: "start", projectPath: "/tmp", prompt: "hi",
      thinkingMode: "fixed", thinkingBudget: 9000,
    });
    expect(capturedOptions.thinking).toEqual({ type: "enabled", budgetTokens: 9000 });
  });

  it("encodes off thinking as disabled", async () => {
    const capturedOptions = await runStartAndCaptureOptions({
      cmd: "start", projectPath: "/tmp", prompt: "hi", thinkingMode: "off",
    });
    expect(capturedOptions.thinking).toEqual({ type: "disabled" });
  });

  it("omits undefined fields so SDK Zod validation is not triggered", async () => {
    const capturedOptions = await runStartAndCaptureOptions({
      cmd: "start", projectPath: "/tmp", prompt: "hi",
    });
    expect(capturedOptions).not.toHaveProperty("model");
    expect(capturedOptions).not.toHaveProperty("effort");
    expect(capturedOptions).not.toHaveProperty("thinking");
    expect(capturedOptions).not.toHaveProperty("fallbackModel");
  });
});
```

> `runStartAndCaptureOptions` is a helper at the top of the existing file (or add one if absent) that stubs `@anthropic-ai/claude-agent-sdk` so `sdk.query({ options })` records the passed options. Mirror the style already in the file.

- [ ] **Step 2: Run to verify they fail**

Run: `task test:backend -- tests/bridge/session-bridge.test.ts`
Expected: FAIL — `effort`, `thinking`, `fallbackModel` not present on options.

- [ ] **Step 3: Implement**

In `packages/backend/src/bridge/session-bridge.ts`:

Extend the `StartCommand` interface:

```ts
interface StartCommand {
  cmd: "start";
  projectPath: string;
  prompt: string;
  sessionId?: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  thinkingMode?: "off" | "adaptive" | "fixed";
  thinkingBudget?: number;
  fallbackModel?: string;
}
```

Replace the `const options: Record<string, unknown> = { … }` block inside `handleStart` with:

```ts
const options: Record<string, unknown> = {
  cwd: cmd.projectPath,
  abortController: activeAbort,
  settingSources: ["user", "project", "local"],
  canUseTool: async (
    toolName: string,
    toolInput: Record<string, unknown>,
    toolOptions: {
      toolUseID: string;
      agentID?: string;
      decisionReason?: string;
    },
  ) => {
    const toolUseID = toolOptions.toolUseID;
    emit({
      type: "tool_confirmation",
      toolUseID,
      toolName,
      toolInput,
      agentID: toolOptions.agentID,
      decisionReason: toolOptions.decisionReason,
    });
    return new Promise<PermissionResult>((resolve) => {
      pendingApprovals.set(toolUseID, { resolve, toolInput });
    });
  },
};

if (cmd.model)          options.model = cmd.model;
if (cmd.fallbackModel)  options.fallbackModel = cmd.fallbackModel;
if (cmd.effort)         options.effort = cmd.effort;
if (cmd.permissionMode) options.permissionMode = cmd.permissionMode;

if (cmd.thinkingMode === "adaptive") {
  options.thinking = { type: "adaptive" };
} else if (cmd.thinkingMode === "fixed" && typeof cmd.thinkingBudget === "number") {
  options.thinking = { type: "enabled", budgetTokens: cmd.thinkingBudget };
} else if (cmd.thinkingMode === "off") {
  options.thinking = { type: "disabled" };
}

if (cmd.sessionId) {
  options.resume = cmd.sessionId;
}
```

Remove the now-duplicate `if (cmd.sessionId) options.resume = …` that used to follow the old block.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test:backend -- tests/bridge/session-bridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/bridge/session-bridge.ts \
        packages/backend/tests/bridge/session-bridge.test.ts
git commit -m "fix(backend): forward effort, thinking, and fallbackModel from bridge to SDK"
```

---

## Task 8: Frontend — Mirror Session type additions

**Files:**
- Modify: `packages/frontend/app/types/index.ts`

- [ ] **Step 1: Extend the frontend Session type**

Append the five fields to the `Session` interface:

```ts
preferredModel: string | null
preferredEffort: string | null
preferredPermissionMode: string | null
thinkingMode: 'off' | 'adaptive' | 'fixed' | null
thinkingBudget: number | null
```

- [ ] **Step 2: Type-check**

Run: `task lint:check`
Expected: zero errors (any fixture using `Session` that is now missing fields will need updating; do those as the error surfaces).

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/app/types/index.ts
git commit -m "chore(frontend): mirror session preference fields"
```

---

## Task 9: Frontend — Capabilities Pinia store

**Files:**
- Create: `packages/frontend/app/stores/capabilities.store.ts`
- Create: `packages/frontend/tests/stores/capabilities.store.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/frontend/tests/stores/capabilities.store.test.ts` (follow the conventions already used in `repository.store.test.ts`):

```ts
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCapabilitiesStore } from '~/stores/capabilities.store'

describe('capabilities store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('fetches and caches /sdk/capabilities', async () => {
    const payload = {
      models: [{ value: 'opus', label: 'Opus' }],
      effortLevels: [{ value: 'high', label: 'High' }],
      permissionModes: [{ value: 'default', label: 'Ask' }],
      thinkingModes: [{ value: 'off', label: 'Off' }],
      defaultThinkingBudget: 8000,
    }
    const fetchSpy = vi.fn().mockResolvedValue(payload)
    // @ts-expect-error test stub for $fetch
    globalThis.$fetch = fetchSpy
    const store = useCapabilitiesStore()
    await store.load()
    expect(store.models).toEqual(payload.models)
    expect(store.defaultThinkingBudget).toBe(8000)
    await store.load()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `task test:frontend -- tests/stores/capabilities.store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/frontend/app/stores/capabilities.store.ts`:

```ts
export interface CapabilityOption<V extends string = string> {
  value: V
  label: string
  supportedModels?: readonly string[]
  dangerous?: boolean
}

interface CapabilitiesPayload {
  models: CapabilityOption[]
  effortLevels: CapabilityOption[]
  permissionModes: CapabilityOption[]
  thinkingModes: CapabilityOption<'off' | 'adaptive' | 'fixed'>[]
  defaultThinkingBudget: number
}

export const useCapabilitiesStore = defineStore('capabilities', () => {
  const config = useRuntimeConfig()
  const loaded = ref(false)
  const models = ref<CapabilityOption[]>([])
  const effortLevels = ref<CapabilityOption[]>([])
  const permissionModes = ref<CapabilityOption[]>([])
  const thinkingModes = ref<CapabilityOption<'off' | 'adaptive' | 'fixed'>[]>([])
  const defaultThinkingBudget = ref(8000)

  async function load() {
    if (loaded.value) return
    const data = await $fetch<CapabilitiesPayload>(
      `${config.public.backendUrl}/sdk/capabilities`,
    )
    models.value = data.models
    effortLevels.value = data.effortLevels
    permissionModes.value = data.permissionModes
    thinkingModes.value = data.thinkingModes
    defaultThinkingBudget.value = data.defaultThinkingBudget
    loaded.value = true
  }

  return { loaded, models, effortLevels, permissionModes, thinkingModes, defaultThinkingBudget, load }
})
```

- [ ] **Step 4: Run to verify it passes**

Run: `task test:frontend -- tests/stores/capabilities.store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/stores/capabilities.store.ts \
        packages/frontend/tests/stores/capabilities.store.test.ts
git commit -m "feat(frontend): add capabilities pinia store"
```

---

## Task 10: Frontend — sessionStore.updatePreferences

**Files:**
- Modify: `packages/frontend/app/stores/session.store.ts`
- Modify: `packages/frontend/tests/stores/session.store.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/frontend/tests/stores/session.store.test.ts`:

```ts
it('PATCHes /sessions/:id/preferences on updatePreferences and merges result into store', async () => {
  const sessionId = 'sess-1'
  const initial = { id: sessionId, repositoryId: 'r', preferredModel: null, thinkingMode: null } as any
  const updated = { ...initial, preferredModel: 'opus', thinkingMode: 'adaptive' }
  const fetchSpy = vi.fn().mockResolvedValue(updated)
  // @ts-expect-error stub
  globalThis.$fetch = fetchSpy

  const store = useSessionStore()
  store.sessions.set(sessionId, initial)
  await store.updatePreferences(sessionId, { preferredModel: 'opus', thinkingMode: 'adaptive' })

  expect(fetchSpy).toHaveBeenCalledWith(
    expect.stringContaining(`/sessions/${sessionId}/preferences`),
    expect.objectContaining({
      method: 'PATCH',
      body: { preferredModel: 'opus', thinkingMode: 'adaptive' },
    }),
  )
  expect(store.sessions.get(sessionId)?.preferredModel).toBe('opus')
  expect(store.sessions.get(sessionId)?.thinkingMode).toBe('adaptive')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `task test:frontend -- tests/stores/session.store.test.ts`
Expected: FAIL — `updatePreferences` undefined.

- [ ] **Step 3: Implement**

In `packages/frontend/app/stores/session.store.ts`, add inside the store setup and include it in the returned object:

```ts
async function updatePreferences(
  sessionId: string,
  prefs: {
    preferredModel?: string | null
    preferredEffort?: string | null
    preferredPermissionMode?: string | null
    thinkingMode?: 'off' | 'adaptive' | 'fixed' | null
    thinkingBudget?: number | null
  },
) {
  const updated = await $fetch<Session>(
    `${config.public.backendUrl}/sessions/${sessionId}/preferences`,
    { method: 'PATCH', body: prefs },
  )
  sessions.value.set(sessionId, updated)
}
```

Extend the `return { … }` to include `updatePreferences`.

- [ ] **Step 4: Run to verify it passes**

Run: `task test:frontend -- tests/stores/session.store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/stores/session.store.ts \
        packages/frontend/tests/stores/session.store.test.ts
git commit -m "feat(frontend): sessionStore.updatePreferences"
```

---

## Task 11: Frontend — PromptToolbar overhaul (capabilities-driven + persistence)

**Files:**
- Modify: `packages/frontend/app/components/prompt/PromptToolbar.vue`
- Modify: `packages/frontend/app/components/prompt/PromptBox.vue`
- Create: `packages/frontend/tests/components/prompt/PromptToolbar.test.ts`

- [ ] **Step 1: Write the failing component test**

`packages/frontend/tests/components/prompt/PromptToolbar.test.ts` (use the same harness conventions as `tests/components/chat/*`):

```ts
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PromptToolbar from '~/components/prompt/PromptToolbar.vue'
import { useCapabilitiesStore } from '~/stores/capabilities.store'
import { useSessionStore } from '~/stores/session.store'

describe('PromptToolbar', () => {
  beforeEach(() => setActivePinia(createPinia()))

  function seedCaps() {
    const caps = useCapabilitiesStore()
    caps.models = [
      { value: 'sonnet', label: 'Sonnet' },
      { value: 'opus',   label: 'Opus' },
    ]
    caps.effortLevels = [
      { value: 'low',   label: 'Low' },
      { value: 'xhigh', label: 'X-High', supportedModels: ['opus'] },
    ]
    caps.permissionModes = [
      { value: 'default', label: 'Ask' },
      { value: 'bypassPermissions', label: 'Bypass', dangerous: true },
    ]
    caps.thinkingModes = [
      { value: 'off', label: 'Off' }, { value: 'adaptive', label: 'Adaptive' }, { value: 'fixed', label: 'Fixed' },
    ]
    caps.defaultThinkingBudget = 8000
    caps.loaded = true
  }

  function seedSession(overrides: Record<string, unknown> = {}) {
    const sessions = useSessionStore()
    sessions.sessions.set('s1', {
      id: 's1', repositoryId: 'r', claudeSessionId: null, name: 's',
      sourceBranch: 'main', workBranch: null, targetBranch: 'main',
      worktreePath: null, state: 'idle',
      createdAt: '', lastActivityAt: '', costUsd: 0, inputTokens: 0, outputTokens: 0,
      preferredModel: null, preferredEffort: null, preferredPermissionMode: null,
      thinkingMode: null, thinkingBudget: null,
      ...overrides,
    } as any)
  }

  it('hydrates initial values from the session preferences', () => {
    seedCaps()
    seedSession({ preferredModel: 'opus', preferredEffort: 'xhigh', thinkingMode: 'fixed', thinkingBudget: 9000 })
    const wrapper = mount(PromptToolbar, { props: { sessionId: 's1' } })
    expect(wrapper.vm.model).toBe('opus')
    expect(wrapper.vm.effort).toBe('xhigh')
    expect(wrapper.vm.thinkingMode).toBe('fixed')
    expect(wrapper.vm.thinkingBudget).toBe(9000)
  })

  it('calls sessionStore.updatePreferences on model change', async () => {
    seedCaps(); seedSession()
    const sessions = useSessionStore()
    const spy = vi.spyOn(sessions, 'updatePreferences').mockResolvedValue()
    const wrapper = mount(PromptToolbar, { props: { sessionId: 's1' } })
    await wrapper.vm.setModel('opus')
    expect(spy).toHaveBeenCalledWith('s1', expect.objectContaining({ preferredModel: 'opus' }))
  })

  it('disables effort options whose supportedModels excludes the current model', () => {
    seedCaps(); seedSession({ preferredModel: 'sonnet' })
    const wrapper = mount(PromptToolbar, { props: { sessionId: 's1' } })
    const disabled = wrapper.vm.effortItems.find((i: any) => i.value === 'xhigh')
    expect(disabled.disabled).toBe(true)
  })

  it('shows budget input only when thinkingMode is fixed', async () => {
    seedCaps(); seedSession({ thinkingMode: 'off' })
    const wrapper = mount(PromptToolbar, { props: { sessionId: 's1' } })
    expect(wrapper.find('[data-test="thinking-budget"]').exists()).toBe(false)
    await wrapper.vm.setThinkingMode('fixed')
    expect(wrapper.find('[data-test="thinking-budget"]').exists()).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `task test:frontend -- tests/components/prompt/PromptToolbar.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite PromptToolbar.vue**

Replace the full file contents:

```vue
<script setup lang="ts">
const props = defineProps<{ sessionId: string }>()

const caps = useCapabilitiesStore()
const sessions = useSessionStore()

onMounted(() => { void caps.load() })

const session = computed(() => sessions.sessions.get(props.sessionId) ?? null)

const model          = ref<string | null>(session.value?.preferredModel ?? null)
const effort         = ref<string | null>(session.value?.preferredEffort ?? null)
const permissionMode = ref<string | null>(session.value?.preferredPermissionMode ?? null)
const thinkingMode   = ref<'off' | 'adaptive' | 'fixed' | null>(session.value?.thinkingMode ?? null)
const thinkingBudget = ref<number | null>(session.value?.thinkingBudget ?? null)

watch(
  () => session.value,
  s => {
    if (!s) return
    model.value          = s.preferredModel
    effort.value         = s.preferredEffort
    permissionMode.value = s.preferredPermissionMode
    thinkingMode.value   = s.thinkingMode
    thinkingBudget.value = s.thinkingBudget
  },
  { immediate: true },
)

const modelItems = computed(() =>
  caps.models.map(m => ({ label: m.label, value: m.value })),
)

const effortItems = computed(() =>
  caps.effortLevels.map(e => ({
    label: e.label,
    value: e.value,
    disabled: Array.isArray(e.supportedModels)
      && !!model.value
      && !e.supportedModels.includes(model.value),
  })),
)

const permissionItems = computed(() =>
  caps.permissionModes.map(p => ({
    label: p.label,
    value: p.value,
    class: p.dangerous ? 'text-red-600 dark:text-red-400' : '',
  })),
)

const thinkingItems = computed(() =>
  caps.thinkingModes.map(t => ({ label: t.label, value: t.value })),
)

let pending: ReturnType<typeof setTimeout> | null = null
function debouncedPersist() {
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    void sessions.updatePreferences(props.sessionId, {
      preferredModel: model.value,
      preferredEffort: effort.value,
      preferredPermissionMode: permissionMode.value,
      thinkingMode: thinkingMode.value,
      thinkingBudget: thinkingBudget.value,
    })
  }, 500)
}

async function setModel(v: string) { model.value = v; debouncedPersist() }
async function setEffort(v: string) { effort.value = v; debouncedPersist() }
async function setPermissionMode(v: string) { permissionMode.value = v; debouncedPersist() }
async function setThinkingMode(v: 'off' | 'adaptive' | 'fixed') {
  thinkingMode.value = v
  if (v === 'fixed' && thinkingBudget.value == null) {
    thinkingBudget.value = caps.defaultThinkingBudget
  }
  debouncedPersist()
}
async function setThinkingBudget(v: number) { thinkingBudget.value = v; debouncedPersist() }

defineExpose({
  model, effort, permissionMode, thinkingMode, thinkingBudget,
  modelItems, effortItems, permissionItems, thinkingItems,
  setModel, setEffort, setPermissionMode, setThinkingMode, setThinkingBudget,
})
</script>

<template>
  <div class="flex items-center gap-2 px-4 py-1.5">
    <USelect
      :model-value="model ?? undefined"
      :items="modelItems"
      placeholder="Model"
      size="xs"
      variant="ghost"
      icon="i-lucide-cpu"
      class="w-28"
      @update:model-value="setModel"
    />
    <USelect
      :model-value="effort ?? undefined"
      :items="effortItems"
      placeholder="Effort"
      size="xs"
      variant="ghost"
      icon="i-lucide-gauge"
      class="w-28"
      @update:model-value="setEffort"
    />
    <USelect
      :model-value="permissionMode ?? undefined"
      :items="permissionItems"
      placeholder="Mode"
      size="xs"
      variant="ghost"
      icon="i-lucide-shield"
      class="w-32"
      @update:model-value="setPermissionMode"
    />
    <USelect
      :model-value="thinkingMode ?? undefined"
      :items="thinkingItems"
      placeholder="Thinking"
      size="xs"
      variant="ghost"
      icon="i-lucide-brain"
      class="w-32"
      @update:model-value="setThinkingMode"
    />
    <UInput
      v-if="thinkingMode === 'fixed'"
      data-test="thinking-budget"
      :model-value="thinkingBudget ?? caps.defaultThinkingBudget"
      type="number"
      :min="1024"
      :step="1024"
      size="xs"
      variant="ghost"
      class="w-24"
      placeholder="Budget"
      @update:model-value="setThinkingBudget"
    />
  </div>
</template>
```

- [ ] **Step 4: Update PromptBox.vue**

Replace the toolbar-ref plumbing in `packages/frontend/app/components/prompt/PromptBox.vue`. Remove the `toolbarRef` template ref and its `defineExpose`. Rewrite `handleSubmit` to read directly from the session record (preferences already persisted by the toolbar):

```ts
async function handleSubmit() {
  const text = promptText.value.trim()
  if (!text || isDisabled.value) return
  isSubmitting.value = true
  try {
    const s = session.value
    await sessionStore.send(props.sessionId, text, {
      model: s?.preferredModel ?? undefined,
      effort: s?.preferredEffort ?? undefined,
      permissionMode: s?.preferredPermissionMode ?? undefined,
      thinkingMode: s?.thinkingMode ?? undefined,
      thinkingBudget: s?.thinkingBudget ?? undefined,
    })
    promptText.value = ''
  } finally {
    isSubmitting.value = false
  }
}
```

And update `<PromptToolbar>` to pass `sessionId` as a prop (drop the `ref="toolbarRef"`):

```vue
<PromptToolbar :session-id="sessionId" />
```

Also update `sessionStore.send()` signature to accept the new options. In `packages/frontend/app/stores/session.store.ts`:

```ts
async function send(
  sessionId: string,
  message: string,
  opts: {
    model?: string
    effort?: string
    permissionMode?: string
    thinkingMode?: 'off' | 'adaptive' | 'fixed'
    thinkingBudget?: number
  } = {},
) {
  await $fetch(`${config.public.backendUrl}/sessions/${sessionId}/send`, {
    method: 'POST',
    body: { message, ...opts },
  })
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `task test:frontend -- tests/components/prompt/PromptToolbar.test.ts`
Expected: PASS.

Run: `task test:frontend`
Expected: all existing frontend tests still PASS (any broken by the Session type additions should be fixed by giving fixtures the new `null` fields).

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/app/components/prompt/PromptToolbar.vue \
        packages/frontend/app/components/prompt/PromptBox.vue \
        packages/frontend/app/stores/session.store.ts \
        packages/frontend/tests/components/prompt/PromptToolbar.test.ts
git commit -m "feat(frontend): PromptToolbar with permission-mode + thinking, session-scoped persistence"
```

---

## Task 12: Frontend — Load capabilities on app boot

**Files:**
- Modify: the app-root component (`packages/frontend/app/app.vue` or the equivalent layout that runs on every page)

- [ ] **Step 1: Inspect the current entry point**

Read `packages/frontend/app/app.vue`. Identify the `onMounted` (or Nuxt `useAsyncData` / plugin) location where the capabilities fetch should fire. If there is no such hook yet, `onMounted` in `app.vue` is acceptable.

- [ ] **Step 2: Add the boot call**

```ts
import { useCapabilitiesStore } from '~/stores/capabilities.store'
// …
const capabilities = useCapabilitiesStore()
onMounted(() => { void capabilities.load() })
```

- [ ] **Step 3: Smoke-test manually**

Run: `task dev`
Open the app, open devtools → Network, confirm a single `GET /sdk/capabilities` request lands, with the expected JSON shape. Switch between sessions and verify no additional requests fire (cached).

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/app/app.vue
git commit -m "feat(frontend): load SDK capabilities on app boot"
```

---

## Task 13: End-to-end verification

- [ ] **Step 1: Full test suite**

Run: `task test:all`
Expected: all backend and frontend tests pass.

- [ ] **Step 2: Lint**

Run: `task lint:check`
Expected: zero errors.

- [ ] **Step 3: Live smoke test**

Run: `task dev`. In a browser:

1. Open an existing session.
2. Pick Opus / X-High / Plan / Adaptive thinking in the toolbar. Observe a debounced `PATCH /sessions/:id/preferences` in devtools.
3. Hard-reload the page. The toolbar should re-render with the same selections (read from DB).
4. Switch `thinkingMode` to `fixed`; budget input appears seeded with `defaultThinkingBudget`. Edit to `12000`; PATCH fires.
5. Submit a message. Verify the bridge receives `effort: 'xhigh'` and `thinking: { type: 'enabled', budgetTokens: 12000 }` (check backend logs if wired, or assert via a temporary console.log in the bridge that you then remove).
6. Pick a model where Effort `xhigh` is not in `supportedModels` (Sonnet/Haiku). The X-High option renders disabled.
7. Create a brand-new session; toolbar renders with no selection (placeholders visible); pick values; they stick after reload.

- [ ] **Step 4: Update `.context/agents/patterns/index.md`**

Add a row documenting the capabilities-driven toolbar pattern:

| Pattern | Location | Summary |
|---|---|---|
| Capabilities-driven chat toolbar | `packages/backend/src/constants/sdk-capabilities.ts` + `packages/frontend/app/stores/capabilities.store.ts` + `packages/frontend/app/components/prompt/PromptToolbar.vue` | Toolbar model / effort / permission-mode / thinking-mode lists originate in a single backend constants module, exposed via `GET /sdk/capabilities`. Frontend Pinia store fetches once at boot and caches. Adding or renaming an SDK-level option = one file edit in the backend constants. Toolbar selections are persisted on the `sessions` row (five nullable columns) via debounced `PATCH /sessions/:id/preferences`; `POST /send` also persists as fallback. |

- [ ] **Step 5: Archive the spec folder** (only once the PR has shipped)

When the work is merged and live, move the spec to `.context/agents/spec/chat-session-controls/archived/` or delete per JRR's convention.

- [ ] **Step 6: Commit the patterns update**

```bash
git add .context/agents/patterns/index.md
git commit -m "docs(patterns): register capabilities-driven chat toolbar pattern"
```

---

## Self-review notes

- Every spec section (§1 problem #1–#5, §2 goals, §4.1–§4.5, §5 API, §7 tests) maps to at least one task. Persistence: Tasks 3–6, 10–11. Capabilities future-proofing: Tasks 1–2, 9, 11. Thinking control: Tasks 5, 6, 7, 11. Permission-mode UI: Task 11. Bridge bug: Task 7.
- No placeholders. Every code step contains the actual code. Every test step contains the actual test body.
- Type names used across tasks are consistent: `preferredModel`, `preferredEffort`, `preferredPermissionMode`, `thinkingMode`, `thinkingBudget`, `updateSessionPreferences` (store), `updatePreferences` (service + frontend), `PATCH /sessions/:id/preferences`.
- `sessionStore.send` signature is extended exactly once (Task 11), which keeps Task 11's `PromptBox` change coherent with Task 5's backend schema.
- `fallbackModel` plumbing is wired through service + bridge (Tasks 5, 7) but deliberately not exposed to the UI (per spec §3 non-goals).
