# Chat Session Controls — Design

> Status: draft · Author: JRR · 2026-04-20
> Scope: per-session persistence + missing toolbar controls (permission mode, thinking), future-proof SDK capability lists, bridge bug fix.

## 1. Problem

The chat prompt toolbar ([PromptToolbar.vue](../../../../packages/frontend/app/components/prompt/PromptToolbar.vue)) today exposes only **Model** and **Effort** with hardcoded, incomplete lists and no persistence. This produces five concrete gaps:

1. **Selections are lost on reload** — toolbar state is a local `ref()` with no storage.
2. **Effort list is incomplete vs. the SDK** — missing `xhigh` (Opus 4.7) and `max` (Opus 4.6/4.7).
3. **No thinking control** — the SDK exposes `thinking?: ThinkingConfig` (`disabled | adaptive | enabled+budgetTokens`) but the UI has no way to reach it.
4. **No execution mode (`permissionMode`) control** — the backend already accepts `permissionMode` end-to-end, only the UI is missing.
5. **Bridge drops `effort`** — [session-bridge.ts:149](../../../../packages/backend/src/bridge/session-bridge.ts#L149) declares `effort` on `StartCommand` and accepts it over the wire but never forwards it into the SDK `options` object; also `fallbackModel` is not wired.

## 2. Goals

- Every toolbar setting (model, effort, permission mode, thinking mode, thinking budget) is **persisted on the Session record** in the SQLite store. Reloads, tab switches, and session re-opens all restore the last-chosen values.
- Future SDK releases that add new model aliases, effort levels, or permission modes require **one file change** (a server-side constants module) and no frontend recompile-time edits.
- The bridge forwards **every** SDK option the UI advertises.
- No backward-compatibility shims — new columns/fields are additive; older rows read `NULL` and fall through to server defaults.

## 3. Non-goals

- Global (per-user) defaults independent of session — preferences live on the session; creating a session inherits the nearest defaults but subsequent edits stay session-local.
- Exposing `fallbackModel` in the UI — plumbing only; UI control deferred.
- Server-side model compatibility enforcement (e.g. blocking `effort: max` on Haiku). The toolbar will *visually* mark unsupported combinations; the SDK silently falls back per its own rules.

## 4. Architecture

### 4.1 Single source of truth: server-owned capability module

A new module `packages/backend/src/constants/sdk-capabilities.ts` defines the authoritative lists of models, effort levels, permission modes, and thinking modes. Shape:

```ts
export interface CapabilityOption<V extends string> {
  value: V
  label: string
  /** Models for which this value is valid. Omit = valid for all. */
  supportedModels?: ReadonlyArray<string>
  /** UX hint: render with danger styling. */
  dangerous?: boolean
}

export const MODELS = [
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus',   label: 'Opus' },
  { value: 'haiku',  label: 'Haiku' },
] as const satisfies ReadonlyArray<CapabilityOption<string>>

export const EFFORT_LEVELS = [
  { value: 'low',    label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high',   label: 'High' },
  { value: 'xhigh',  label: 'X-High', supportedModels: ['opus'] },
  { value: 'max',    label: 'Max',    supportedModels: ['opus'] },
] as const

export const PERMISSION_MODES = [
  { value: 'default',           label: 'Ask first' },
  { value: 'plan',              label: 'Plan' },
  { value: 'acceptEdits',       label: 'Accept edits' },
  { value: 'auto',              label: 'Auto' },
  { value: 'dontAsk',           label: "Don't ask" },
  { value: 'bypassPermissions', label: 'Bypass', dangerous: true },
] as const

export const THINKING_MODES = [
  { value: 'off',      label: 'Off' },
  { value: 'adaptive', label: 'Adaptive' },
  { value: 'fixed',    label: 'Fixed budget' },
] as const

export const DEFAULT_THINKING_BUDGET = 8000
```

Exposed via `GET /sdk/capabilities`. The frontend fetches on app boot, caches in a Pinia store, and the toolbar reads *only* from that store. Adding a new effort level = edit this one file + backend test drift check.

### 4.2 Persistence: five new columns on `sessions`

Additive migration:

```sql
ALTER TABLE sessions ADD COLUMN preferredModel TEXT;
ALTER TABLE sessions ADD COLUMN preferredEffort TEXT;
ALTER TABLE sessions ADD COLUMN preferredPermissionMode TEXT;
ALTER TABLE sessions ADD COLUMN thinkingMode TEXT;
ALTER TABLE sessions ADD COLUMN thinkingBudget INTEGER;
```

All nullable. `NULL` means "not yet chosen" → backend omits the field when building SDK options, SDK applies its own defaults. No hardcoded app-level defaults at the persistence layer.

### 4.3 Preference write path

Two write moments, both persist the same columns:

- `PATCH /sessions/:id/preferences` — called from the toolbar on every change (debounced client-side 500 ms). Body: any subset of `{ preferredModel, preferredEffort, preferredPermissionMode, thinkingMode, thinkingBudget }`.
- `POST /sessions/:id/send` — continues to accept the same fields in the body. When present they are persisted before the SDK call, for defense in depth (covers the case where a user changes toolbar then immediately submits without the debounce landing).

The `SessionService.send` reads the persisted values from the DB **after** the optional write, then builds the SDK options object. Toolbar values and DB values are kept in sync on every send; a page reload reads the DB-backed `Session` and hydrates the toolbar.

### 4.4 Bridge: forward the full option set

`StartCommand` on the bridge already has `model`, `effort`, `permissionMode`. We extend it with `thinkingMode`, `thinkingBudget`, `fallbackModel` and construct the SDK `options` map accordingly:

```ts
const options: Record<string, unknown> = {
  cwd: cmd.projectPath,
  abortController: activeAbort,
  settingSources: ['user', 'project', 'local'],
  canUseTool: /* … unchanged … */,
}
if (cmd.model)             options.model = cmd.model
if (cmd.fallbackModel)     options.fallbackModel = cmd.fallbackModel
if (cmd.effort)            options.effort = cmd.effort
if (cmd.permissionMode)    options.permissionMode = cmd.permissionMode
if (cmd.thinkingMode === 'adaptive')    options.thinking = { type: 'adaptive' }
else if (cmd.thinkingMode === 'fixed'
         && typeof cmd.thinkingBudget === 'number')
         options.thinking = { type: 'enabled', budgetTokens: cmd.thinkingBudget }
else if (cmd.thinkingMode === 'off')    options.thinking = { type: 'disabled' }
```

Guard pattern (`if (value) options.X = value`) ensures undefined values are never serialized into SDK input and blow up Zod validation.

### 4.5 UI

**Toolbar** ([PromptToolbar.vue](../../../../packages/frontend/app/components/prompt/PromptToolbar.vue)) becomes a five-control strip:

| Control | Icon | Options source | Notes |
|---|---|---|---|
| Model | `i-lucide-cpu` | `MODELS` | |
| Effort | `i-lucide-gauge` | `EFFORT_LEVELS` | items whose `supportedModels` excludes the current model are rendered disabled with a tooltip "not supported on `<model>`" |
| Permission mode | `i-lucide-shield` | `PERMISSION_MODES` | danger variant for `bypassPermissions` |
| Thinking | `i-lucide-brain` | `THINKING_MODES` + inline number input when `fixed` | budget input shows only when mode = `fixed` |

The toolbar binds to a Pinia-derived `sessionPreferences(sessionId)` computed. Each change:

1. Updates local pinia state immediately (UI is instant).
2. Fires debounced `PATCH /sessions/:id/preferences`.

**On mount** the toolbar reads from the loaded `Session` record. No `localStorage`, no global `ref`.

## 5. API surface

### 5.1 New

- `GET /sdk/capabilities` → `{ models, effortLevels, permissionModes, thinkingModes, defaultThinkingBudget }`.
- `PATCH /sessions/:id/preferences` — body is a partial preference record. Returns updated `Session`.

### 5.2 Extended

- `POST /sessions/:id/send` — body gains `thinkingMode?`, `thinkingBudget?`. Persists any prefs present before invoking the SDK.

### 5.3 Types

`Session` (both `packages/backend/src/types/index.ts` and `packages/frontend/app/types/index.ts`) gains:

```ts
preferredModel: string | null
preferredEffort: string | null
preferredPermissionMode: string | null
thinkingMode: 'off' | 'adaptive' | 'fixed' | null
thinkingBudget: number | null
```

## 6. Failure modes & safeguards

- **SDK renames an effort value**: the old persisted string is sent as-is; SDK rejects it; we surface the error via the existing `bridge:error` channel. Fix is a constants update + a one-time data migration if needed. No silent fallback that could hide a real bug.
- **User picks `bypassPermissions` without server-side `allowDangerouslySkipPermissions`**: SDK will reject. Acceptable; danger label is already on the control. Wiring the server flag is out of scope.
- **Debounced PATCH loses the last change on unload**: send-path persistence catches it the next time the user actually submits. Unsubmitted toolbar flicks that are lost on hard-unload are acceptable — they were never committed.

## 7. Test strategy

- **Store migration**: assert new columns exist and are nullable; existing rows read `NULL`.
- **Capabilities route**: JSON shape stable across versions; drift test against the constants module.
- **Session routes**: PATCH persists; send body overrides stored prefs; SDK receives the expected option map (asserted via bridge spy).
- **Bridge**: given a `StartCommand` with each preference variant, the constructed `options` object matches the SDK schema exactly (including `thinking` shapes).
- **Frontend**: toolbar renders from capabilities store (not hardcoded); PATCH is called on change; mount reads prefs from session.

## 8. Open questions

None blocking. Future work:
- Expose `fallbackModel` in the UI.
- Server-side `allowDangerouslySkipPermissions` flag behind an env var for `bypassPermissions`.
- Per-repository or per-user default preferences that new sessions inherit.
