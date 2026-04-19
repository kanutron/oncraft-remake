# Chat render modes — future work

> **Purpose:** track deliberately deferred items from [`design.md`](./design.md). Revisit each as a standalone spec when the time is right. Do not implement these alongside the base chat-render-modes spec unless a stakeholder explicitly scopes them in.

> **How to use this file:** when picking up one of these items, promote it to its own spec folder under `.context/agents/spec/<slug>/`, move the entry here into an "Archived — promoted to spec" section, and link the new spec from the entry.

---

## 1 · User preferences engine

**Problem.** The base spec hard-codes default render modes per event type. Users will want rules such as "all tools = badge, failed tools = compact, assistant text = full, last user message sticky". Today those rules live in code.

**Hook already in place.** `useChatRenderMode` resolves mode via this precedence chain:

```
userOverride → sticky → preferencesResolver(kind, data) → defaultModeByKind[kind]
```

`preferencesResolver` is the slot for a rules engine. It reads from user settings and returns a mode (or `undefined` to fall through to the static default).

**Open questions for the future spec.**
- Rule storage: per-user global? per-repository? per-session? Probably a cascading merge.
- Rule shape: simple `{ when: { kind, status, … }, then: mode }` predicates, or a DSL.
- UI: a settings panel under the session header? Inline "always show tools as compact" affordances in the chat?
- Whether rules can also influence **relationship classification** (e.g., downgrade a T3 from spawn to side-channel) or only the render mode. The current architecture allows both; the preferences spec should decide policy.

**Relates to:** override persistence (next item) — they share storage concerns.

---

## 2 · Override persistence

**Problem.** `useChatRenderMode` is in-memory only. A user who expands a tool call to `full`, refreshes the page, and returns finds it back at `badge`.

**Candidate storage.**
- `localStorage` keyed by `session-id + componentKey`. Scoped per session, capped with LRU eviction.
- `IndexedDB` if the volume grows large (a long session with many overrides).
- Server-side (per-user setting) if cross-device persistence is desired.

**Decisions needed.**
- Should overrides survive session deletion? (Probably no.)
- TTL for overrides? Do stale overrides quietly expire?
- How does this interact with the preferences engine — does an explicit override "pin" the mode until reset, even if a preference rule would say otherwise? (Likely yes — overrides are imperative, preferences are declarative defaults.)

---

## 3 · Virtualization / windowed rendering

**Problem.** The MVP assumes a bounded message count per session. Long-running sessions with thousands of events will degrade scroll and reactivity performance.

**Candidate approach.** `@tanstack/virtual` or `vue-virtual-scroller` on `ChatHistory`'s scroll container. Each rendered row is a `Component` descriptor from the reducer.

**Complications to resolve.**
- `ChatStickyRegion` must remain outside the virtualized viewport.
- Variable-height rows from mode toggles (collapsed ↔ expanded) need resize observers.
- Auto-scroll-on-new-message needs to know whether the bottom is in view.
- Badge rows that wrap change height as the viewport resizes; virtualization with dynamic height is trickier than fixed-height.

**Trigger.** Introduce when a typical session exceeds ~500 components or we measure scroll jank.

---

## 4 · Promotion of T3 variants to dedicated components

**Problem.** Seven SDK variants currently render via `ChatGenericSystemEvent`: `plugin_install`, `auth_status`, `files_persisted`, `mirror_error`, `prompt_suggestion`, `session_state_changed`, `rate_limit`. They get a minimal type + subtype + summary row. If any becomes a recurring, information-dense part of real sessions, a dedicated component with a tailored UX is warranted.

**Promotion is cheap.** Add a component, flip the registry entry's `component` field, remove the generic fallback for that type. No architectural change.

**Candidates to watch for first promotion.**
- `rate_limit` — when users hit quotas often. Could get a contextual countdown / quota bar.
- `session_state_changed` — if model / permission-mode switches become frequent, a richer timeline row.

---

## 5 · Rich tool-confirmation previews

**Problem.** `ChatToolConfirmation` refactor in the base spec preserves existing UX — a bar with allow/deny. For file-mutating tools (Edit, Write) a diff preview would dramatically improve decision quality. For Bash, syntax-highlighted command preview.

**Scope for the future spec.**
- Diff rendering (unified or side-by-side) for Edit / MultiEdit / Write.
- Syntax highlight for Bash command previews.
- Resource summary (file paths, byte counts, redaction indicators).
- Keyboard shortcuts in the confirmation (Y/N).
- Trust rules: "always allow Read in this session" — ties into the preferences engine.

---

## 6 · Accessibility pass

**Problem.** The base spec covers keyboard mode-toggle basics (`←/→/0`) but stops there. Screen readers, live-region announcements, ARIA roles, and high-contrast coverage are deferred.

**Scope.**
- ARIA live-region for newly arriving assistant text (polite vs assertive).
- Landmark roles on the chat container and sticky region.
- Screen-reader labels for every icon-only button (mode toggles, chevrons, collapse icons).
- High-contrast mode validation (NuxtUI tokens mostly cover this, but audit needed).
- Focus management: where does focus land when a sticky component appears / disappears?
- Respect `prefers-reduced-motion` for streaming shimmer and transitions.

---

## 7 · Mobile layout adaptations

**Problem.** The base spec is desktop-first. On mobile:
- Sticky region eats vertical space that's already scarce.
- Badge rows overflow horizontally rather than wrapping if envelope width is tight.
- Touch targets for mode toggles are small.
- Toolbar affordances (shift+click, alt+click) have no touch equivalent.

**Scope.**
- Collapsing sticky region into a floating indicator on mobile.
- Larger touch targets for mode toggles; long-press replaces shift/alt modifiers.
- Breakpoint-specific defaults (e.g., tools default to `badge` on mobile regardless of desktop default).
- Safe-area insets for iOS.

---

## 8 · Export / search / copy

**Problem.** No affordances for exporting a transcript, searching within history, or copying an individual message. Useful for debugging, sharing, and regression reporting.

**Scope.**
- Copy: per-component copy button (the assistant text, the tool output, the whole turn).
- Export: Markdown / JSON / SDK-raw-events dump of the current session.
- Search: in-session text search with highlighting and scroll-to-match, honoring current render modes.
- Permalink to a specific message within a session (ties into URL routing).

---

## 9 · Cross-session memory of overrides

**Problem.** Overrides are per-`componentKey` (which is typically a correlation id like `tool_use_id` — unique to that session). If a user clones a session or resumes after a restart, overrides don't transfer.

**Why it might matter.** For power users who always want to see certain tools in a certain mode, this is table-stakes once the preferences engine lands — preferences will express that intent more naturally than cross-session overrides. So this item might dissolve into (1) rather than ship standalone.

**Decision to defer:** revisit after the preferences engine is in place. If preferences cover the real user need, this item is closed.

---

## Tracking

| # | Item | Trigger to revisit | Depends on |
|---|---|---|---|
| 1 | User preferences engine | After base spec ships and users ask for per-type rules | — |
| 2 | Override persistence | After base spec ships; tied to (1) | (1) partly |
| 3 | Virtualization | When typical session > 500 components or scroll jank measured | — |
| 4 | T3 promotion | On user feedback that a specific T3 event is under-served | — |
| 5 | Rich tool-confirmation | After MVP; high user value | — |
| 6 | Accessibility | Before a broader rollout | — |
| 7 | Mobile layout | When mobile becomes a supported surface | — |
| 8 | Export / search / copy | When debugging / sharing needs emerge | — |
| 9 | Cross-session overrides | After (1) — may be absorbed | (1) |
