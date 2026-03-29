# E2E Test Patterns — OnCraft Remake

> Patterns discovered during live debug session (2026-03-28).
> To be formalized as Playwright test suites.

## Test Flow: Happy Path — Full Session Lifecycle

### 1. Server Health

```
GIVEN backend and frontend are running
WHEN GET /health on :3101
THEN response is { status: "ok" }
AND GET :3100 returns 200
```

**Playwright pattern:** Navigate to `http://localhost:3100`, assert page loads. Hit `/health` API endpoint.

### 2. Workspace Auto-Activation

```
GIVEN a workspace exists in the database
WHEN the page loads
THEN the workspace tab is active (green underline)
AND the workspace view shows (not the "Open Workspace" form)
```

**Playwright pattern:** Assert `.border-primary-500` class on workspace tab button. Assert no "Open Workspace" heading visible.

**Bug found:** `fetchAll()` didn't auto-set `activeWorkspaceId` — fixed in `workspace.store.ts`.

### 3. Session Creation with Worktree

```
GIVEN an active workspace
WHEN user clicks "+" in session tab bar
THEN the "New Session" dialog opens
WHEN user fills name, sourceBranch, targetBranch and clicks Create
THEN session tab appears with "idle" badge
AND session header shows "sourceBranch → targetBranch"
AND git worktree is created (verify via `git worktree list`)
```

**Playwright pattern:**
- Click `.bg-white .flex.items-center.px-2 button` to open dialog
- Fill `form .flex.flex-col.gap-1:nth-child(1) input` (name)
- Fill `form .flex.flex-col.gap-1:nth-child(2) input` (source branch)
- Target branch pre-filled as "main"
- Click `button[type="submit"]`
- Assert session tab text and badge

**Bugs found:**
- `git worktree add` failed for non-existent branches — fixed with `-b` flag in `GitService.createWorktree()`
- Dialog showed no error on failure — fixed with `UAlert` in `NewSessionDialog.vue`

### 4. Send Prompt and Receive Response

```
GIVEN an active session in idle state
WHEN user types in the prompt box and presses Enter
THEN session state transitions: idle → starting → active
AND system/hook messages stream in
AND assistant response appears in chat
AND session state returns to idle
AND response renders with UChatMessage (bot avatar, left-aligned)
```

**Playwright pattern:**
- Fill `textarea[placeholder="Send a message..."]` with prompt
- Press Enter
- Wait for assistant message: `document.querySelector('.group\\/message')` appears
- Assert text content of the assistant message
- Assert session badge shows "idle" after completion

**Critical bugs found:**
- `canUseTool` was outside `options` in `sdk.query()` — SDK never registered the callback, fell back to default permission mode requiring TTY, Claude process exited with code 1
- `MessageStream` didn't implement `SDKUserMessage` correctly (missing `message` and `parent_tool_use_id` fields)
- `resolveMessageType` checked `role` instead of `type` for assistant messages
- `AssistantMessage` extracted content from wrong path (top-level instead of `message.content`)

### 5. Session Error Recovery

```
GIVEN the bridge process encounters an error
THEN session state transitions to "error"
AND bridge:error message appears in chat
```

**Bug found:** Session stayed in `active` state forever after bridge error — fixed by listening for `bridge:error` events in `SessionService`.

### 6. Worktree Cleanup

```
GIVEN a session with a worktree
WHEN the session is deleted via API
THEN the worktree is removed
AND the branch can be deleted
```

**Playwright pattern:** Delete session via API, verify `git worktree list` doesn't include the worktree path.

## Selectors Reference

| Element | Selector |
|---------|----------|
| Workspace tab (active) | `.border-primary-500` |
| Workspace "+" button | `.bg-neutral-50 .flex.items-center.px-2 button` |
| Session "+" button | `.bg-white .flex.items-center.px-2 button` |
| Session name input | `form .flex.flex-col.gap-1:nth-child(1) input` |
| Source branch input | `form .flex.flex-col.gap-1:nth-child(2) input` |
| Create button | `button[type="submit"]` |
| Prompt textarea | `textarea[placeholder="Send a message..."]` |
| Assistant message | `.group\/message` |
| Session tab by name | `button:has-text("session-name")` |
| Session state badge | Session tab's nested badge element |

## Test Infrastructure Notes

- **Backend startup:** `bun` may not be in PATH from spawned processes — use absolute path `$HOME/.bun/bin/bun`
- **WebSocket monitoring:** Use Bun's native `WebSocket` for monitoring events during tests (Node.js requires `ws` package)
- **Timing:** Claude agent responses take 10-30 seconds; use generous timeouts (40s+)
- **Message persistence:** Messages are in-memory only — page reload clears them
- **HMR:** Backend uses `bun --watch`; frontend uses Nuxt HMR — code changes auto-reload but may cause brief disconnections
- **Process cleanup:** Always verify ports 3100/3101 are free before/after tests via `lsof -ti:PORT`
- **Worktree location:** Created at `../.oncraft-worktrees/<branch-slug>` relative to workspace path
