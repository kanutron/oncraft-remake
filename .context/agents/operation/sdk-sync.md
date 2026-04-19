# sdk-sync — Agent Operation

Keep the frontend chat event registry in sync with `@anthropic-ai/claude-agent-sdk`.

## When to run

- Every time `@anthropic-ai/claude-agent-sdk` is bumped in `packages/backend/package.json` (and mirrored in `packages/frontend/package.json` as a devDep).
- When the drift test (`registry-drift.test.ts`) fails to compile.
- Periodically: once per minor SDK release (quarterly baseline).

## Procedure

1. **Bump the SDK** to the target version in both `packages/backend/package.json` and `packages/frontend/package.json`. Run `pnpm install`.

2. **Run the drift test:** `task test:frontend`. Note every `Drift` compile error — these are uncovered SDK types.

3. **For each uncovered type+subtype pair:**
   - Determine the tier (T1 / T2 / T3) based on expected user-facing value.
   - Determine the relationship (spawn / mutate / fan-out / side-channel / replace / discard).
   - Determine the correlation key (if mutate / replace). Use the extractor-function form in `event-registry.ts`.
   - Choose a default render mode (badge / compact / full).
   - If a new dedicated component is warranted, scaffold it under `app/components/chat/ChatXxx.vue` following the pattern of existing siblings; otherwise set `component: 'ChatGenericSystemEvent'`.
   - Add the descriptor to `CHAT_EVENT_REGISTRY`.

4. **For each registry entry whose `sdkType` no longer exists in the SDK:**
   - Remove the entry.
   - Delete the associated component if it becomes unreferenced (`rg "ChatXxx"`).

5. **Bump `SDK_VERSION` constant** at the top of `event-registry.ts` to the new version. All entries inherit this.

6. **Rerun the drift test:** `task test:frontend`. Must pass.

7. **Update patterns if needed:** if the sync revealed a novel event family (e.g. a new correlation scheme), add an entry to `.context/agents/patterns/index.md`.

8. **Run the full gate:** `task lint:check && task test:all`. Commit with a `chore(frontend): sync chat event registry to SDK x.y.z` message.

## Escalation

If the SDK removes `SDKMessage` as a union or renames core types (`assistant`, `user`, `result`), this operation alone isn't sufficient. Treat it as a breaking change: open a spec in `.context/agents/spec/` and realign the types in `types/chat.ts` before running sync.

## References

- Registry: `packages/frontend/app/composables/chat/event-registry.ts`
- Types: `packages/frontend/app/types/chat.ts`
- Drift test: `packages/frontend/tests/composables/chat/registry-drift.test.ts`
- Design spec: `.context/agents/spec/chat-render-modes/design.md`
