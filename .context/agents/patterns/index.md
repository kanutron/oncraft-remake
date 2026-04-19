# OnCraft Remake — Patterns Index

Patterns discovered during implementation sessions.

## Patterns

| Pattern | Location | Summary |
|---|---|---|
| Chat event registry | `packages/frontend/app/composables/chat/event-registry.ts` | Single source of truth mapping SDK event types to render components, relationships, correlation keys, and default render modes. Guarded by a build-time drift test against `SDKMessage`. |
