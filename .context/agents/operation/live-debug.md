# Operation: Live Debug

Launch the full OnCraft stack, observe it through multiple channels, interact with the UI via Playwright, and tear down cleanly.

## When to Use

- Reproducing a reported bug that requires a running application
- Exploring the UI to collect issues (e.g., building a sprint backlog)
- Verifying a fix end-to-end after code changes
- Any task where you need to observe frontend + backend behavior together

This operation can be self-invoked when the agent determines it needs a running app, or explicitly requested by the user.

---

## 1. Pre-Flight Checks

**Always run these before anything else.**

### 1.1 Check for Existing Processes

```bash
lsof -ti:3100 2>/dev/null
lsof -ti:3101 2>/dev/null
```

If either port is occupied:

1. **Warn the user** — report which ports are in use and by what process
2. **Offer to take ownership** — ask the user if you should kill the existing processes and spawn your own
3. **Do NOT proceed** until the user confirms — never silently kill processes you did not start

If the user approves, kill the occupying processes:

```bash
kill $(lsof -ti:3100) 2>/dev/null
kill $(lsof -ti:3101) 2>/dev/null
```

Wait briefly and verify ports are free before continuing.

### 1.2 Verify Dependencies

- `bun` is available in PATH
- `pnpm` is available in PATH
- Playwright MCP server is connected (test with `playwright_navigate` or check MCP tool availability)
- `.local/debug-logs/` directory exists (create if not)

```bash
mkdir -p .local/debug-logs
```

---

## 2. Launch Servers

Start both servers as background processes, piping all output to log files.

### 2.1 Backend

Use absolute paths from the project root (`$PROJECT_ROOT` = the repo root where `Taskfile.yml` lives):

```bash
cd $PROJECT_ROOT/packages/backend && bun --watch src/server.ts > $PROJECT_ROOT/.local/debug-logs/backend.log 2>&1 &
echo $! > $PROJECT_ROOT/.local/debug-logs/backend.pid
```

### 2.2 Frontend

```bash
cd $PROJECT_ROOT/packages/frontend && pnpm dev > $PROJECT_ROOT/.local/debug-logs/frontend.log 2>&1 &
echo $! > $PROJECT_ROOT/.local/debug-logs/frontend.pid
```

**Note:** `pnpm dev` spawns a child Nuxt process. The PID stored in `frontend.pid` is the pnpm wrapper, not the Nuxt server itself. Killing the wrapper may not propagate to the child — this is why section 5.3 includes a fallback port-scan kill.

### 2.3 Health Check

Wait for both servers to be ready before proceeding:

- **Backend** — grep for `OnCraft backend listening on port` in `backend.log`, or curl `http://localhost:3101`
- **Frontend** — grep for `Local:` in `frontend.log`, or curl `http://localhost:3100`

Timeout after 30 seconds. If either server fails to start, check the logs and report the error.

---

## 3. Open Browser

Use Playwright MCP to open the application:

```
playwright_navigate → http://localhost:3100
```

The browser is now ready for task-driven interaction. What you do next depends on the task at hand (reproduce a bug, explore the UI, verify a fix, etc.).

---

## 4. Observe

Use these channels on-demand throughout the session. Do not continuously poll — read when you need information.

### 4.1 Server Logs

Tail the last N lines from log files when investigating an issue:

```bash
tail -50 .local/debug-logs/backend.log
tail -50 .local/debug-logs/frontend.log
```

For targeted searches:

```bash
grep -i "error\|warn\|fail" .local/debug-logs/backend.log
grep -i "error\|warn\|fail" .local/debug-logs/frontend.log
```

### 4.2 Browser Console Logs

```
playwright_console_logs
```

Captures JavaScript errors, warnings, and `console.*` output from the frontend.

### 4.3 Network Errors

Use Playwright MCP to monitor failed API calls:

- `playwright_expect_response` — wait for a specific response after an action
- `playwright_assert_response` — verify response status codes

Watch for 4xx/5xx responses, especially on API calls to `:3101`.

### 4.4 Screenshots

Capture visual evidence when something breaks or for reporting:

```
playwright_screenshot
```

Screenshots are saved to `.local/debug-logs/screenshot-<timestamp>.png` or the default Playwright output location. Reference them in bug reports or commit messages.

---

## 5. Teardown

**Mandatory. No session ends with servers still running.**

### 5.1 Close Browser

```
playwright_close
```

### 5.2 Kill Servers

```bash
kill $(cat $PROJECT_ROOT/.local/debug-logs/backend.pid) 2>/dev/null
kill $(cat $PROJECT_ROOT/.local/debug-logs/frontend.pid) 2>/dev/null
```

### 5.3 Verify Clean Shutdown

```bash
lsof -ti:3100 2>/dev/null
lsof -ti:3101 2>/dev/null
```

If any process remains, force kill:

```bash
kill -9 $(lsof -ti:3100) 2>/dev/null
kill -9 $(lsof -ti:3101) 2>/dev/null
```

### 5.4 Keep Artifacts

Log files and screenshots in `.local/debug-logs/` are preserved for reference within the session. They are gitignored and will be overwritten on the next debug session.

---

## Rules

1. **Process ownership** — if you didn't start it, you don't control it. Always check ports first, always ask before killing.
2. **Teardown is non-negotiable** — every code path that exits the debug session must go through teardown. This includes errors, user interruption, and task completion.
3. **Logs are on-demand** — don't read logs continuously. Read them when you need to diagnose something or when the task requires collecting observations.
4. **Screenshots on failure** — whenever you encounter a UI error, take a screenshot before investigating further. Visual evidence is cheap and invaluable.
5. **This document grows** — add troubleshooting entries below as you encounter and solve issues.

---

## Troubleshooting

<!--
Add entries as they are discovered. Format:

### <Short symptom description>

**Symptom:** What you observed
**Cause:** What was actually wrong
**Fix:** How to resolve it
-->

(No entries yet — this section grows as agents encounter and resolve issues during live-debug sessions.)
