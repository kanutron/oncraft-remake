# Chat render modes — design

> **Status:** design approved, awaiting implementation plan
> **Target SDK:** `@anthropic-ai/claude-agent-sdk@0.2.114` (validated baseline)
> **Companion files:** [`future-work.md`](./future-work.md) — deferred items to revisit

## Problem

The chat session needs to render the full stream of events produced by the Claude Agent SDK — 29 top-level message variants, 6 content-block types, and several bridge-level wrappers. Current `ChatHistory.vue` renders a small subset with a single visual treatment per type. This spec defines a rigorous, extensible rendering system that:

- Covers every SDK event type with a dedicated component (or a deliberate generic fallback).
- Offers three render modes per component — **badge**, **compact**, **full** — user-togglable per instance.
- Supports sticky components (starting with last user message and active tool confirmation).
- Provides a hook for a future user-preferences engine that will drive default rendering.
- Stays in sync with `@anthropic-ai/claude-agent-sdk` releases via a repeatable operation.

## Core concepts

### Render modes

Every chat component renders itself in one of three modes:

| Mode | CSS `display` | Visual treatment |
|---|---|---|
| `badge` | `inline-flex` | Icon + very short label, chip-sized. Flows inline so successive badges wrap naturally within their envelope. |
| `compact` | `block` | One or two lines: tool name / args / status / truncated output. |
| `full` | `block` | Dedicated region with full detail (command, output, diff, cost breakdown, etc.). |

No grouping logic is needed. Within a block-flow container, inline-flex badges naturally wrap at line boundaries; a block-display compact/full element between them forces a new line. Toggling a component's mode changes only its CSS class — DOM order never reorders.

Icons throughout the UI are **Lucide** icons via NuxtUI's `UIcon` (e.g., `i-lucide-search`, `i-lucide-file-edit`). Emoji are not used.

### Event → component relationships

Every incoming SDK event falls into one of six categories, classified by a single function:

| Relationship | Description |
|---|---|
| **spawn** | Event creates a new component (the common case). |
| **mutate** | Event updates an existing component identified by a correlation key (streaming deltas, progress updates, finalize). |
| **fan-out** | One event produces multiple components (an assistant message with multiple content blocks). |
| **side-channel** | Event updates UI outside the chat stream — session header, status bar, toast. |
| **replace** | A later event supersedes an earlier component (e.g., user-message replay on session resume). |
| **discard** | Event never renders in the stream (`bridge:ready`, `bridge:stderr`, heartbeats). |

**Correlation keys** — the mechanism that makes Mutate work:

| Family | Key |
|---|---|
| Tool invocation | `tool_use_id` |
| Assistant streaming | `message.id` |
| Hooks | `hook_callback_id` |
| Tasks / subagents | `task_id` |
| Elicitation | `elicitation_id` |
| Session-level state | `session_id` |

### Per-instance override

Each component keeps its own render-mode state, stored outside the component for durability. Defaults flow from the type registry (and, later, a preferences engine) but any click by the user overrides the default for that specific instance until reset.

## Architecture

Three decoupled layers:

```
WebSocket ← backend bridge ← Claude Agent SDK
       │
       ▼  (raw SDK events, bridge wrappers)
┌─────────────────────────────────────────────────────────┐
│  Layer 1 · Chat reducer (domain state)                 │
│  - Classifier: event → relationship                    │
│  - Keyed store by correlation id                       │
│  - Emits: ordered Component[]                          │
│  - Also emits: side-channel events → session header    │
└─────────────────────────────────────────────────────────┘
       │
       ▼  Component[] = { componentKey, kind, data, defaultMode }
┌─────────────────────────────────────────────────────────┐
│  Layer 2 · Chat components (view)                      │
│  - One dedicated component per SDK variant + block     │
│  - Uniform contract: { componentKey, defaultMode, data}│
│  - Three render functions per component                │
│  - NuxtUI primitives where they fit                    │
└─────────────────────────────────────────────────────────┘
       │                               │
       ▼ reads/writes                  ▼ renders
┌──────────────────────────────┐     ChatHistory
│  Layer 3 · useChatRenderMode │     ─ sticky region (last user)
│   Map<componentKey,          │     ─ scroll / auto-scroll
│         RenderMode>          │
│  + default resolver          │
└──────────────────────────────┘

       side-channel events ────────▶ SessionHeader / status bar / toasts
```

### Layer 1 — Chat reducer (`useChatReducer`)

- Subscribes to session messages in `sessionStore` (the existing raw `ChatMessage[]` source stays the source of truth; the reducer is a derived layer).
- Runs each event through `classifyEvent(event)`, a pure lookup against the event registry.
- Maintains a keyed store of in-flight entities (tool calls, streaming messages, task entries, hook entries, elicitations) and the ordered list of components to render.
- Emits:
  - A reactive, ordered `Component[]` for the chat stream.
  - A side-channel signal stream for session-header / status-bar / toast consumers.
- **Pure-ish:** no UI concerns, no DOM. Unit-testable by feeding recorded event sequences.

### Layer 2 — Chat components

- One component per SDK variant or content block (see inventory below).
- Uniform contract: `{ componentKey, defaultMode, data }`.
- Each component defines three render branches (`badge` / `compact` / `full`) selected by the resolved mode.
- Composes NuxtUI primitives where fit is natural:
  - `UChatMessage` — envelope for assistant / user.
  - `UChatTool` (`inline` / `card` variants, collapsible, `streaming`) — tool_use in compact / full.
  - `UChatReasoning` — thinking block collapsed / open.
  - `UChatShimmer` — streaming text cursor.
- Our own components for badge mode (all types) and for event types NuxtUI doesn't cover (tool confirmation, result summary, system events).
- Mode-toggle affordances are always visible (not hover-gated):
  - `badge` → click badge → `compact`.
  - `compact` → trailing chevron → `full`; leading collapse icon → `badge`.
  - `full` → chevron (pointing up) → `compact`; shift+click chevron → `badge`.
  - Alt+click any toggle → reset to default (removes the override).
- Keyboard on focused component: `←` collapse one level, `→` expand one level, `0` reset.

### Layer 3 — `useChatRenderMode`

- Reactive `Map<componentKey, RenderMode>` for per-instance overrides.
- Exposes `useRenderMode(key, default) → { mode, setMode, reset }`.
- **Mode resolution precedence** (single function, replaceable):
  1. `userOverride[componentKey]` — highest priority, set by click.
  2. `stickyMode(component)` — sticky forces `compact`.
  3. `preferencesResolver(kind, data)` — future: rules engine (not MVP).
  4. `defaultModeByKind[kind]` — current: static table sourced from the event registry.
- In-memory only for MVP. Persistence is future work.

## Component inventory

Total: **~28 Vue components + 4 composables**.

Legend: **bold** = new, *italic* = refactored from existing. Tiers: **T1** core, **T2** important, **T3** rare, **BR** bridge.

### Layer 1 — Envelopes

| Component | SDK type | Tier | Default modes | Notes |
|---|---|---|---|---|
| *ChatAssistantMessage* | `assistant` | T1 | `full` (text), `compact` (tool-heavy) | Fan-out over `content[]`. `UChatMessage` variant=naked. |
| *ChatUserMessage* | `user` (prompt) | T1 | `full` (sticky candidate) | `UChatMessage` variant=soft side=right. Last one = sticky. |
| **ChatUserReplay** | `user` (replay) | T2 | `full` | Visually identical to ChatUserMessage + replay marker. |

### Layer 2 — Content blocks (rendered inside envelopes, block-flow parent)

| Component | Block | Tier | Default modes | NuxtUI |
|---|---|---|---|---|
| **ChatBlockText** | `text` | T1 | `full` | Raw markdown renderer. |
| *ChatBlockThinking* | `thinking` | T1 | `compact` | `UChatReasoning`. |
| **ChatBlockToolUse** | `tool_use` + paired `tool_result` | T1 | `badge` (default), `compact` (failed) | `UChatTool` inline (compact) / card (full). Badge is ours. |
| **ChatBlockImage** | `image` | T2 | `compact` | Thumbnail + lightbox on full. |
| **ChatBlockRedactedThinking** | `redacted_thinking` | T3 | `badge` | Minimal icon + tooltip. |

### Layer 1b — Event-specific components

| Component | SDK type(s) | Tier | Default modes | Notes |
|---|---|---|---|---|
| **ChatResult** | `result` (success / error_*) | T1 | `compact` | Cost / tokens / duration. `UAlert` on error. |
| *ChatSystemInit* | `system/init` | T1 | `compact` | Model, cwd, tools. Existing SystemMessage refactored. |
| **ChatCompactBoundary** | `system/compact_boundary` | T1 | `badge` | Horizontal rule + label. |
| **ChatAPIRetry** | `system/api_retry` | T2 | `compact` | `UAlert` color=warning. |
| **ChatLocalCommandOutput** | `system/local_command_output` | T2 | `compact` | Mono + collapsible on full. |
| **ChatNotification** | `system/notification` | T2 | `compact` | Inline notice (also emits toast via side-channel if severe). |
| **ChatToolUseSummary** | `tool_use_summary` | T2 | `compact` | Post-compaction recap. |
| **ChatHookEntry** | `hook_started` / `hook_progress` / `hook_response` | T2 | `compact` | Stateful — one row, mutates through lifecycle. `UChatTool` reused. |
| **ChatTaskEntry** | `task_started` / `task_updated` / `task_progress` / `task_notification` | T2 | `compact` | Stateful — subagent lifecycle. |
| **ChatMemoryRecall** | `system/memory_recall` | T3 | `badge` | Dedicated (user-facing value). |
| **ChatElicitationComplete** | `system/elicitation_complete` | T3 | `compact` | Dedicated (user-facing value). |
| **ChatGenericSystemEvent** | T3 stream-spawn overflow: `plugin_install` · `files_persisted` | T3 | `badge` | Single fallback for T3 events classified as `spawn`. Type + subtype + brief summary. Promoted to dedicated if UX demand appears. |

**Side-channel T3 events** (`session_state_changed`, `auth_status`, `mirror_error`, `prompt_suggestion`, `rate_limit`) never reach the chat stream — they are routed by the reducer to the side-channel emitter and consumed by `SessionHeader` / status bar / toasts. They have registry entries but no chat component.

### Bridge-level components

| Component | Bridge event | Tier | Default modes | Notes |
|---|---|---|---|---|
| *ChatToolConfirmation* | `session:tool-confirmation` | BR | `full` (sticky candidate) | Approval UI. Existing ToolApprovalBar refactored. |
| *ChatBridgeError* | `bridge:error` | BR | `full` | Existing ErrorNotice refactored. |

### Container / layout

| Component | Role | Status |
|---|---|---|
| *ChatHistory.vue* | Top-level container: renders reducer output, owns scroll + auto-scroll + sticky region. | refactored |
| **ChatStickyRegion** | Renders pinned components (`position: sticky; top: 0`) at the top of the scroll viewport. | new |

**Removed from earlier design iterations:**

- `ChatBadgeRow` — not needed. CSS `display: inline-flex` on badges makes successive badges wrap within block-flow envelopes naturally. No grouper, no wrapper component.

### Composables / infrastructure

| Composable | Role |
|---|---|
| `useChatReducer(sessionId)` | Subscribes to session messages, classifies each event, maintains keyed state, exposes reactive `Component[]` + side-channel emitter. |
| `classifyEvent(event)` | Pure function: SDK event → `{ relationship, correlationKey, kind }`. Single source of truth for the 6 cases. Lookup against the event registry. |
| `useChatRenderMode()` | UI-only override store. `useRenderMode(key, default) → { mode, setMode, reset }`. |
| `resolveDefaultMode(kind, data)` | Type → default mode table sourced from the event registry. Replaceable by a preferences resolver later without touching components. |

## Render-mode mechanics

### Toggle interactions

```
badge       click badge                     ──▶  compact
compact     click chevron (trailing)        ──▶  full
compact     click collapse-icon (leading)   ──▶  badge
full        click chevron (pointing up)     ──▶  compact
full        shift+click chevron             ──▶  badge        (skip-level)

reset to default:  alt+click any toggle    ──▶  default      (removes override)
```

Keyboard on focused component: `←` collapse, `→` expand, `0` reset.

### Sticky region

- `ChatStickyRegion` pins flagged components at the top of the scroll viewport via `position: sticky; top: 0`.
- The reducer output includes a `sticky` flag per component; `ChatHistory` splits output into `stickyItems` and `streamItems`.
- **Eligibility rules** (hardcoded in MVP, preference-driven later):
  - Latest `ChatUserMessage` → sticky while any assistant activity is in progress.
  - Active `ChatToolConfirmation` → sticky (blocks scroll-away from approval).
- **Sticky components render in `compact` mode** regardless of stream-mode, keeping the bar thin. User can still toggle to full.

### Streaming

- `SDKPartialAssistantMessage` events arrive as deltas and are dispatched as `mutate` on the in-flight assistant component (correlation key: `message.id`).
- The component re-renders reactively. Mode selection is independent of streaming state — a user can toggle a streaming tool to full and watch output arrive in real time.
- Visual indicators:
  - `ChatBlockText` during streaming → inline `UChatShimmer` at cursor position.
  - `ChatBlockToolUse` in badge mode during streaming → pulsing dot on the chip.
  - `ChatBlockToolUse` in compact/full → `UChatTool`'s built-in `streaming` prop.

## SDK-sync pattern

The chat layer tracks a rapidly evolving SDK. The risk is silent drift — the SDK adds a message type and we either never render it or render it wrongly. The following pattern prevents drift.

### Event registry — single source of truth

```ts
// packages/frontend/app/composables/chat/event-registry.ts

export interface ChatEventDescriptor {
  /** SDK "type" field (e.g. "assistant", "system", "result"). */
  type: string
  /** Optional "subtype" (e.g. "init", "compact_boundary"). */
  subtype?: string
  /** Our internal kind — drives component selection. */
  kind: ChatEventKind
  /** How the reducer handles it: the 6 relationships. */
  relationship: 'spawn' | 'mutate' | 'fan-out' | 'side-channel' | 'replace' | 'discard'
  /** For mutate/replace: how to find the correlation key on the event. */
  correlationPath?: string  // e.g. "message.content[*].tool_use_id"
  /** Tier: T1 dedicated, T2 dedicated, T3 generic fallback. */
  tier: 'T1' | 'T2' | 'T3'
  /** Component to render (undefined = generic fallback). */
  component?: string  // e.g. "ChatBlockToolUse"
  /** Default render mode when no user override. */
  defaultMode: 'badge' | 'compact' | 'full'
  /** SDK interface name — must match SDK types exactly. */
  sdkType: string  // e.g. "SDKAssistantMessage"
  /** SDK version this entry was last validated against. */
  sdkVersionValidated: string
}

export const CHAT_EVENT_REGISTRY: ChatEventDescriptor[] = [ /* one per variant */ ]
```

Reducer, component resolver, and default-mode resolver all read from this single table.

### Automation

- **Build-time type guard:** a test that enumerates `SDKMessage` union members and asserts the registry's `sdkType` values cover the union exhaustively. Breaks the build on drift. Runs in CI and `task lint:check`.
- **SDK bump hook:** when `package.json` bumps `@anthropic-ai/claude-agent-sdk`, the drift test runs. Failure auto-links the PR to `operation/sdk-sync.md`.
- **Backend passthrough audit:** bridge-side test asserts the set of `type+subtype` combinations emitted matches the registry. Unknown events pass through with a warning log, landing on the frontend as `ChatGenericSystemEvent`.

### Operation — `.context/agents/operation/sdk-sync.md`

A repeatable procedure (agent or human) invoked on every SDK version bump:

1. **Diff the SDK types** — parse `export declare type SDKMessage = …` from the SDK `.d.ts` and compare against `CHAT_EVENT_REGISTRY`.
2. **Classify new variants** — for each new SDK type missing from the registry, decide tier, relationship, correlation key, and default mode; add an entry.
3. **Flag removed/renamed types** — registry entries whose `sdkType` no longer exists in the SDK are removed; the associated component is deleted.
4. **Bump `sdkVersionValidated`** on every touched entry.
5. **Rerun the drift test** — must pass.
6. **Update `.context/agents/patterns/index.md`** if the sync revealed a new pattern (e.g., a new event family with a novel correlation scheme).

## Repository layout

```
packages/frontend/app/composables/chat/
  ├── event-registry.ts         # single source of truth
  ├── use-chat-reducer.ts       # reducer + keyed state
  ├── use-chat-render-mode.ts   # override store + default resolver
  ├── classify-event.ts         # pure classifier
  └── __tests__/
      ├── registry-drift.test.ts   # fails build on SDK drift
      ├── classify-event.test.ts
      ├── use-chat-reducer.test.ts
      └── use-chat-render-mode.test.ts

packages/frontend/app/components/chat/
  ├── ChatHistory.vue
  ├── ChatStickyRegion.vue
  ├── ChatAssistantMessage.vue        # refactored
  ├── ChatUserMessage.vue             # refactored
  ├── ChatUserReplay.vue
  ├── ChatBlockText.vue
  ├── ChatBlockThinking.vue           # refactored from ThinkingBlock
  ├── ChatBlockToolUse.vue            # refactored from ToolInvocation
  ├── ChatBlockImage.vue
  ├── ChatBlockRedactedThinking.vue
  ├── ChatResult.vue
  ├── ChatSystemInit.vue              # refactored from SystemMessage
  ├── ChatCompactBoundary.vue
  ├── ChatAPIRetry.vue
  ├── ChatLocalCommandOutput.vue
  ├── ChatNotification.vue
  ├── ChatToolUseSummary.vue
  ├── ChatHookEntry.vue
  ├── ChatTaskEntry.vue
  ├── ChatMemoryRecall.vue
  ├── ChatElicitationComplete.vue
  ├── ChatGenericSystemEvent.vue
  ├── ChatToolConfirmation.vue        # refactored from ToolApprovalBar
  └── ChatBridgeError.vue             # refactored from ErrorNotice

.context/agents/operation/
  └── sdk-sync.md                     # runnable audit procedure
```

## Testing strategy

| Layer | What it verifies |
|---|---|
| **Unit — event classifier** | Table-driven: one case per registry entry, asserting `{ relationship, correlationKey, kind }`. Fixtures from recorded SDK events. |
| **Unit — chat reducer** | Recorded event sequences. Scenarios: streaming text (multiple `stream_event` → single mutating assistant), paired `tool_use` + `tool_result` by `tool_use_id`, hook lifecycle collapsing to one entry, `compact_boundary` insertion, user-message replay replacing optimistic entry. Side-channel events must not appear in stream output. |
| **Unit — render-mode store** | Override set/reset, resolution precedence (override → sticky → default), reactivity. |
| **Component — each T1/T2 component** | Renders correctly in badge / compact / full from the same props. Toggle affordances (click, keyboard) mutate the store. Streaming flag switches visuals. CSS `display` asserted via computed style: badge → `inline-flex`, compact/full → `block`. |
| **Build-time — drift** | Exhaustive-union assertion against `SDKMessage`. Fails build if the SDK adds a type not in the registry. |
| **E2E — live-debug** | Run a real session via `operation/live-debug.md`, record events, assert rendered DOM matches per-variant snapshots. Not CI-blocking; gate for feature-complete sign-off. |

## Out of scope

Items explicitly deferred to future specs. See [`future-work.md`](./future-work.md) for trackable stubs.

- User preferences engine.
- Override persistence (localStorage).
- Virtualization / windowed rendering.
- Promotion of T3 variants to dedicated components.
- Rich tool-confirmation previews (diffs, syntax highlighting).
- Accessibility beyond keyboard basics.
- Mobile layout.
- Export / search / copy of chat history.
- Cross-session memory of overrides.

## Pre-push gate compliance

Every PR under this spec must pass the project pre-push gate (`CLAUDE.md`):

- `task lint:check` — zero errors, includes the drift test.
- `task test:all` — all backend + frontend tests pass (new reducer / classifier / component / store tests).
- No debug artifacts, no hardcoded secrets, conventional commits.
- `AGENTS.md` updated to register `operation/sdk-sync.md`.
- `.context/agents/patterns/index.md` gets a "Chat event registry" pattern entry.
