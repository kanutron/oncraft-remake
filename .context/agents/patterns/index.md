# OnCraft Remake — Patterns Index

Patterns discovered during implementation sessions.

## Patterns

| Pattern | Location | Summary |
|---|---|---|
| Chat event registry | `packages/frontend/app/composables/chat/event-registry.ts` | Single source of truth mapping SDK event types to render components, relationships, correlation keys, and default render modes. Guarded by a build-time drift test against `SDKMessage`. |
| Bridge emit payload shape | `packages/backend/src/bridge/session-bridge.ts` + `services/process-manager.ts` | Bridge must NOT emit a top-level `sessionId` field. The process-manager spreads the bridge event over its own `{ sessionId: <internal UUID>, ...event }`, and a bridge-side `sessionId` would override the internal one — routing events to a phantom session on the frontend. Only emit event-specific fields; let the PM add `sessionId`. |
| Subagent embedding (Agent tool_use) | `packages/frontend/app/composables/chat/use-subagent-correlation.ts` + `components/chat/ChatBlockToolUse.vue` + `ChatSubagentTranscript.vue` | Subagent transcripts render inline inside their parent Agent `tool_use` card. Correlation uses `(agentType, description)` from `.meta.json` matched against parent's `input.{subagent_type, description}`, with positional pairing for duplicate pairs. Live subagent turns (SDK events carrying `parent_tool_use_id`) are indexed in the store by that id and merged with hydrated (`.jsonl`) messages, deduped by `uuid`. Nested rendering reuses the reducer + resolver pipeline so nested chats match top-level behavior. |
