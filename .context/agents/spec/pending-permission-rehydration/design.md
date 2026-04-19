# Pending Permission Rehydration

Reloading the page during a pending `canUseTool` approval silently orphans the session. The bridge keeps the unresolved promise forever, the UI never shows the banner again, and the session gets stuck in `state=active` — the frontend's hydrate gate then refuses to load history, so opening the session shows no messages.

Reported 2026-04-19 during chat-comps fixes (session `chat-comps-improvements`, worktree `.oncraft-worktrees/working-chat-comps-improvements`). Trigger: a Bash tool call entered `canUseTool`, emitted a `tool_confirmation` event, the user reloaded before responding, the banner never reappeared, the tool stayed "stuck".

## Symptoms

1. Session card opens to an empty chat even though the session was mid-conversation.
2. Send is disabled / no response — backend thinks the session is busy.
3. Only recovery is interrupt/stop/delete, which discards the in-flight turn.

## Root cause

Three compounding gaps in the pending-approval lifecycle:

1. **Bridge state is in-memory only.** `pendingApprovals` in `packages/backend/src/bridge/session-bridge.ts` is a `Map` inside the bridge process. If the WS client disconnects and reconnects, there's no mechanism to re-advertise entries that are still waiting.
2. **`tool_confirmation` is a live-only event.** It's emitted once by `canUseTool` and never persisted (by design — it doesn't belong in the SDK's `.jsonl`). The frontend stores it in Pinia; on reload, Pinia is empty and the event is gone.
3. **Hydrate is gated on `state !== 'active'`.** [session.store.ts:82](../../../../packages/frontend/app/stores/session.store.ts#L82) skips `loadHistory` while a session is active. Combined with (1) and (2), a stuck session has no path back to a usable UI.

## Proposed approach

Add a **pending-approvals registry** exposed to the frontend so reconnect/reload can rebuild the UI state.

### Backend

- Track pending approvals in `SessionService` (or a small `PermissionService`) keyed by `(sessionId, toolUseID)`. The bridge continues to own the resolver; the service owns the metadata (`toolName`, `toolInput`, `agentID`, `decisionReason`, `requestedAt`). Bridge emits `tool_confirmation` → service records; `reply` → service clears.
- New endpoint: `GET /sessions/:id/pending-approvals` — returns the current pending entries for a session (empty array when none).
- On WS (re)connect, push a `session:pending-approvals` snapshot for each subscribed session so late-joining clients catch up without polling.
- Clear entries on session `interrupt`/`stop`/`destroy` and on bridge process exit (and resolve with `{ behavior: 'deny', message: 'Session interrupted.' }` if the bridge is still alive, so the SDK unwinds cleanly).

### Frontend

- On `setActive`, fetch pending approvals before (or alongside) `hydrate` and seed the chat stream with synthetic `tool_confirmation` messages so `ChatToolConfirmation` renders and Allow/Deny work normally.
- On WS reconnect, consume the `session:pending-approvals` snapshot.
- Loosen the hydrate gate: `state === 'active'` should still hydrate when `messages.length === 0`. The current gate was protecting against double-hydrate during a live stream, but that's better expressed as "skip if the WS feed is live AND we already have messages".

### Reply-path safety

When the bridge handles `reply`, verify the `toolUseID` still exists in `pendingApprovals` (already the case). Also add a timestamp-based TTL / orphan sweep: if a pending approval has no matching live `canUseTool` promise (e.g. bridge restarted), the service should drop the entry and surface a `bridge:error` for the client rather than leaving a ghost banner.

## Out of scope

- Persisting pending approvals across backend restarts. The SDK's `canUseTool` promise cannot survive a process restart; the in-memory lifetime of the bridge is the upper bound. A restart legitimately invalidates in-flight approvals.
- Changing the SDK's `canUseTool` contract.

## Acceptance

- Reloading the browser during a pending approval re-shows the banner within 1s of page load.
- Stopping/interrupting a session resolves any pending approvals with a deny so the SDK query loop exits.
- `state=active` no longer traps sessions with zero messages: opening them triggers hydrate as long as no live stream is already populating the store.
- Coverage: backend unit test for the registry (record/list/clear), WS reconnect snapshot test, frontend reducer test that synthetic tool_confirmations from the snapshot render identically to live ones.

## References

- Bridge payload & lifecycle pattern: [.context/agents/patterns/index.md](../../patterns/index.md) — "Bridge `tool_confirmation` payload + lifecycle"
- Related code: [session-bridge.ts](../../../../packages/backend/src/bridge/session-bridge.ts), [session.service.ts](../../../../packages/backend/src/services/session.service.ts), [session.store.ts](../../../../packages/frontend/app/stores/session.store.ts), [ChatToolConfirmation.vue](../../../../packages/frontend/app/components/chat/ChatToolConfirmation.vue), [use-chat-reducer.ts](../../../../packages/frontend/app/composables/chat/use-chat-reducer.ts)
