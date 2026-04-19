# Rich Markdown Rendering — Design

## Problem

Agent chat messages, tool inputs, and tool outputs currently render as plain text via `whitespace-pre-wrap`. Markdown structure, code blocks, diffs, tables, and rich HTML emitted by agents collapse into an unreadable wall of monospace. We want a sanitized, syntax-highlighted, Nuxt-native renderer that stays fast during streaming and gives agents room to produce rich, meaningful output.

## Scope

**In scope**

- Assistant text blocks (markdown with GFM, code, tables, images, links)
- Bash tool call rendering — command as `bash`/`zsh` fenced block, stdout as fenced block with auto-JSON detection for structured outputs
- Generic tool JSON outputs — pretty-printed as `json` fenced blocks
- Edit/Write tool rendering — synthesized unified `diff` for Edit, language-by-extension fenced block for Write
- Read tool rendering — language-by-extension fenced block with line numbers matching the `offset` param
- File-path and `file:line` linkification (VSCode-style `[file.ts:42](file.ts#L42)`)
- Stack trace detection and formatting for JS and Python in tool error output
- Mermaid fences via dynamic import
- Collapsible wrapper for long code/output blocks (> N lines)
- Auto-link for bare URLs (markdown-it linkify)

**Out of scope**

- Todo-list rendering (separate future treatment)
- Status/meta chips, duration, cost badges (already handled by existing components)
- Subagent-specific UI (already handled by `ChatSubagentTranscript`)
- Image lightbox, favicon/title cards for URLs, LaTeX/math, HTML preview iframes
- Back-compat shims for the existing plain-text rendering

## Key Decisions

### 1. markdown-it over MDC or marked

`markdown-it` is the core parser. Reasons:

- **Explicit HTML pass-through.** `html: true` lets agent-generated raw HTML flow through the parser, and DOMPurify is the single point where we decide what survives. `@nuxtjs/mdc` leans on rehype-raw and its own `::component` syntax — harder to sanitize predictably against prompt-injected output.
- **Streaming-friendly.** Re-rendering on each partial assistant message is cheap; no async rehype pipeline to wait on.
- **Plugin ecosystem.** GFM tables and strikethrough are built-in. Linkify is built-in via the `linkify: true` option. Custom post-processors (file paths, stack traces) are simple token rules.

### 2. Shiki via `@shikijs/markdown-it`

Shiki ships VS Code TextMate grammars, so `bash`, `zsh`, `sh`, `json`, `diff`, `ts`, `python`, `vue` all highlight cleanly out of the box.

- Preload the languages we actually use — `bash, shell, sh, zsh, json, ts, tsx, js, jsx, vue, python, diff, yaml, toml, md, html, css`.
- Dual theme (`github-light` / `github-dark`) mapped via the `themes` option so dark-mode switching is automatic.
- Initialization is async, but `@shikijs/markdown-it` integrates it into a single `await md.use(...)` call. The composable exposes a `ready` signal so the first render before init completes falls back to an escaped `<pre>` — reactive re-render once the highlighter is ready.

### 3. DOMPurify with an explicit allowlist

Because we keep `html: true`, sanitization is mandatory. Prompt injection can smuggle `<script>`, `onerror=`, `javascript:` URIs through an agent. DOMPurify:

- Allowlists tags (`details`, `summary`, `kbd`, `mark`, `table`/`thead`/`tbody`/`tr`/`td`/`th`, `img`, `svg` + children).
- Allows `style` on `span`, `pre`, `code` so shiki's inline token colors survive (alternative — CSS-variable theming — adds complexity we don't need today).
- Restricts URL schemes to `http`, `https`, `mailto`, relative paths. No `javascript:`, no `data:` except for images.

### 4. Single `<RichMarkdown>` component + `useMarkdown()` composable

- `useMarkdown()` returns a synchronous `render(source: string): string` that calls markdown-it + sanitizer. Internal state (shiki highlighter, cached `md` instance) is module-scoped singletons.
- `<RichMarkdown :source>` is a thin Vue component that computes the HTML and mounts it under a `prose prose-sm dark:prose-invert` container.
- Tool-specific rendering is split into **formatters** — small pure functions that transform a tool's `input`/`tool_result` into a markdown string. The same `<RichMarkdown>` then renders that markdown. This keeps the rendering pipeline single-path and makes each formatter independently testable.

### 5. Post-processing after sanitize

File-path linkification and stack-trace formatting run **on the sanitized HTML**, not on the markdown source. Two reasons:

- They apply to both assistant text and tool output uniformly.
- Running them post-sanitize means the DOM is trusted, and we can use a lightweight regex/DOMParser walk without reintroducing injection risk.

### 6. Phased rollout

Each phase delivers something usable on its own:

| Phase | Delivers |
|---|---|
| 1 — Foundation | Composable + component + tests, used by nothing yet |
| 2 — Assistant text | `ChatBlockText` renders real markdown |
| 3 — Bash & JSON | `ChatBlockToolUse` renders bash calls and JSON outputs with syntax highlighting |
| 4 — Diffs & file reads | Edit/Write/Read tools render as diffs / fenced code |
| 5 — Post-processors | File paths and stack traces become linkified and styled |
| 6 — Polish | Mermaid fences, collapsible long outputs |

## Architecture

### File layout

```
packages/frontend/app/
├── components/chat/
│   ├── RichMarkdown.vue              # NEW — the reusable renderer
│   ├── ChatBlockText.vue             # MOD — full-mode uses RichMarkdown
│   └── ChatBlockToolUse.vue          # MOD — uses formatters + RichMarkdown
└── composables/chat/markdown/
    ├── use-markdown.ts               # NEW — MarkdownIt + shiki singleton + render
    ├── sanitize.ts                   # NEW — DOMPurify config + sanitize()
    ├── post-processors.ts            # NEW — file-path and stack-trace HTML walkers
    └── tool-formatters.ts            # NEW — Bash/Edit/Write/Read/JSON → markdown
```

Tests mirror the structure under `packages/frontend/tests/`.

### Render pipeline

```
source (markdown string)
  → markdown-it.render(source)        # parse + shiki highlight
  → DOMPurify.sanitize(html)          # allowlist enforcement
  → post-processors (file paths, stack traces)
  → string of trusted HTML
```

For tool blocks:

```
tool-formatter(tool.input, tool.tool_result)  → markdown string → (pipeline above)
```

### Streaming

The composable's `render` function is synchronous after shiki init. While init is pending, render falls back to an escaped `<pre>`; a reactive `version` counter flips when init completes, triggering a re-render through normal Vue reactivity. Each partial assistant update is a fresh `render(source)` call — markdown-it is fast enough (~sub-ms for typical turns) that no memoization is required in v1. If profiling reveals hot spots during stream, add an LRU keyed on the source string.

### NuxtUI alignment

- Typography via `@tailwindcss/typography` (`prose` classes are already referenced in existing code but the plugin isn't wired).
- Collapsibles use `UCollapsible` from NuxtUI v4.
- Icons stay Lucide via `UIcon name="i-lucide-*"`.

## Non-goals / deferred

- **Caching rendered HTML.** Not needed until profiling says so.
- **Server-side rendering.** App is SSR-off (`ssr: false` in `nuxt.config.ts`); no isomorphic DOMPurify work required.
- **Custom Vue components inside markdown.** If that need ever appears, the pipeline can swap to MDC without affecting the surface API of `<RichMarkdown>`.
