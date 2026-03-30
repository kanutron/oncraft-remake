# AGENTS.md — OnCraft Remake

## Purpose

OnCraft Remake is a web tool for managing parallel Claude Code sessions across git repositories. It provides a dashboard to orchestrate, monitor, and interact with multiple agentic coding sessions running in different worktrees.

The domain model is: **Project > Repository > Session**.

## Architecture

| Layer | Stack | Location |
|---|---|---|
| Backend | Bun + Fastify | `packages/backend/` |
| Frontend | Nuxt 4 SPA | `packages/frontend/` |
| Monorepo | pnpm workspaces | root `pnpm-workspace.yaml` |

## Operations

All commands use [Task](https://taskfile.dev/) (see `Taskfile.yml`).

| Command | What it does |
|---|---|
| `task dev` | Start backend + frontend dev servers in parallel |
| `task build` | Build all packages |
| `task test:all` | Run all tests (backend + frontend) |
| `task lint:check` | Lint all packages |

Package-scoped variants: `task dev:backend`, `task test:frontend`, etc.

### Agent Operations

Autonomous procedures agents can invoke or be directed to run. Located in `.context/agents/operation/`.

| Operation | What it does |
|---|---|
| [live-debug](.context/agents/operation/live-debug.md) | Launch full stack, observe via logs + Playwright browser, interact with UI, tear down cleanly |

## Constraints

1. **Bun runtime** for backend — NOT Node.js. Use `bun test`, `bun build`, `bunx`.
2. **pnpm** for package management — no npm or yarn.
3. **NuxtUI v4** for all UI components — no custom CSS, no Tailwind utilities outside NuxtUI.
4. **Conventional commits** required on every commit.
5. **Specs and plans** live under `.context/agents/spec/` — never under `docs/`.
6. **No backward compatibility** unless explicitly instructed.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3101` | Backend server port |
| `CORS_ORIGIN` | `http://localhost:3100` | Allowed CORS origin |
| `DB_PATH` | `oncraft.db` | SQLite database path |
| `ONCRAFT_FS_ROOT` | `~` (user home) | Root directory for the filesystem browser. Controls which paths the `GET /filesystem/list-dirs` endpoint can access. Set to `/` for sandboxed/Docker deployments |

## Key References

- Design spec: `.context/agents/spec/oncraft-remake/design.md`
- Implementation plan: `.context/agents/spec/oncraft-remake/plan.md`
- Patterns index: `.context/agents/patterns/index.md`
- Agent operations: `.context/agents/operation/`

## Startup Protocol

Every agent session must:

1. Read this file (`AGENTS.md`)
2. Read `.context/agents/patterns/index.md`
3. Verify you are on the correct branch and working directory
