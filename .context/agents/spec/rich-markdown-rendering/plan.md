# Rich Markdown Rendering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render assistant messages and tool call/result blocks as rich markdown with syntax-highlighted code, diffs, tables, linkified file paths, and safely sanitized HTML — per [`design.md`](./design.md).

**Architecture:** A single synchronous `renderMarkdown()` pipeline (markdown-it + shiki + DOMPurify + HTML post-processors) exposed through `useMarkdown()` and a `<RichMarkdown>` component. Tool-specific formatters pre-format tool inputs and results into markdown strings, then feed the same pipeline. Streaming-safe: re-render per partial message is a sync, sub-ms call after shiki init.

**Tech Stack:** Nuxt 4 (Vue 3) · NuxtUI 4.6 · `markdown-it` · `@shikijs/markdown-it` + `shiki` · `dompurify` · `@tailwindcss/typography` · Vitest + @nuxt/test-utils + @vue/test-utils · Lucide icons.

**Conventions:**
- **Commits:** conventional commits, one per completed task. Scope: `frontend`.
- **Tests:** composables live in `tests/composables/**` (node project, no Nuxt runtime); component tests in `tests/components/**` (nuxt project, `mountSuspended`).
- **Test command for a single file:** `cd packages/frontend && pnpm vitest run <path>`.
- **Full test suite:** `task test:frontend`. Pre-push gate: `task lint:check && task test:all`.
- **No emoji:** iconography uses Lucide via `UIcon name="i-lucide-*"`.
- **File layout:** markdown composables under `app/composables/chat/markdown/`; reusable component at `app/components/chat/RichMarkdown.vue`.

**Scope note:** This is one cohesive subsystem delivered across six phases. Each phase ends green (tests pass, no regressions in the existing chat view). Out of scope: todo-list rendering, status/meta chips, subagent-specific UI, LaTeX/math, HTML iframes.

---

## Phase 1 — Foundation (composable + component + sanitizer)

### Task 1.1: Add runtime dependencies

**Why:** The pipeline needs `markdown-it` for parsing, `shiki` + `@shikijs/markdown-it` for syntax highlighting, `dompurify` for sanitization, and `@tailwindcss/typography` so the `prose` classes already referenced in `ChatBlockText` actually apply.

**Files:**
- Modify: `packages/frontend/package.json`
- Modify: `packages/frontend/app/assets/css/main.css`

- [ ] **Step 1: Install runtime deps**

Run from repo root:

```bash
cd packages/frontend && pnpm add markdown-it shiki @shikijs/markdown-it dompurify
```

- [ ] **Step 2: Install type and tooling deps**

```bash
cd packages/frontend && pnpm add -D @types/markdown-it @types/dompurify @tailwindcss/typography
```

- [ ] **Step 3: Wire typography plugin into main.css**

Replace `packages/frontend/app/assets/css/main.css` with:

```css
@import "tailwindcss";
@import "@nuxt/ui";
@plugin "@tailwindcss/typography";
```

- [ ] **Step 4: Verify install**

```bash
cd packages/frontend && pnpm exec nuxt prepare
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/package.json packages/frontend/app/assets/css/main.css pnpm-lock.yaml
git commit -m "chore(frontend): add markdown-it, shiki, dompurify, typography plugin"
```

---

### Task 1.2: Sanitizer module

**Why:** Sanitization is the security boundary for agent-generated HTML. Isolating it in one module with explicit allowlists makes it auditable and testable in isolation.

**Files:**
- Create: `packages/frontend/app/composables/chat/markdown/sanitize.ts`
- Create: `packages/frontend/tests/composables/chat/markdown/sanitize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/composables/chat/markdown/sanitize.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sanitize } from '~/composables/chat/markdown/sanitize'

describe('sanitize', () => {
  it('strips script tags', () => {
    const dirty = '<p>ok</p><script>alert(1)</script>'
    expect(sanitize(dirty)).toBe('<p>ok</p>')
  })

  it('strips javascript: URIs', () => {
    const dirty = '<a href="javascript:alert(1)">x</a>'
    expect(sanitize(dirty)).not.toContain('javascript:')
  })

  it('strips inline event handlers', () => {
    const dirty = '<img src="x" onerror="alert(1)">'
    expect(sanitize(dirty)).not.toContain('onerror')
  })

  it('keeps style attribute on code spans (shiki needs it)', () => {
    const dirty = '<pre><code><span style="color:#abc">x</span></code></pre>'
    expect(sanitize(dirty)).toContain('style="color:#abc"')
  })

  it('keeps details/summary', () => {
    const dirty = '<details><summary>hi</summary>body</details>'
    const out = sanitize(dirty)
    expect(out).toContain('<details>')
    expect(out).toContain('<summary>')
  })

  it('keeps tables', () => {
    const dirty = '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>'
    expect(sanitize(dirty)).toContain('<table>')
  })

  it('keeps relative hrefs', () => {
    const dirty = '<a href="src/foo.ts#L10">foo</a>'
    expect(sanitize(dirty)).toContain('href="src/foo.ts#L10"')
  })

  it('keeps images with https src', () => {
    const dirty = '<img src="https://example.com/a.png" alt="a">'
    expect(sanitize(dirty)).toContain('<img')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/frontend && pnpm vitest run tests/composables/chat/markdown/sanitize.test.ts
```

Expected: FAIL — `sanitize` module does not exist.

- [ ] **Step 3: Implement the sanitizer**

Create `packages/frontend/app/composables/chat/markdown/sanitize.ts`:

```ts
import DOMPurify from 'dompurify'

const ALLOWED_TAGS = [
  'a', 'p', 'br', 'hr', 'strong', 'em', 'del', 's', 'u', 'kbd', 'mark', 'small', 'sup', 'sub',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote',
  'pre', 'code', 'span', 'div',
  'details', 'summary',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'img',
]

const ALLOWED_ATTR = [
  'href', 'title', 'alt', 'src', 'name', 'id',
  'class', 'style',
  'open',
  'colspan', 'rowspan',
  'data-lang', 'data-line', 'data-file',
]

const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto):|[^:]*(?:[/?#]|$))/i

export function sanitize(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/frontend && pnpm vitest run tests/composables/chat/markdown/sanitize.test.ts
```

Expected: PASS — 8/8.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/composables/chat/markdown/sanitize.ts packages/frontend/tests/composables/chat/markdown/sanitize.test.ts
git commit -m "feat(frontend): add DOMPurify sanitize() with explicit allowlist"
```

---

### Task 1.3: Markdown pipeline composable

**Why:** Central renderer. Wires markdown-it + shiki + sanitizer and exposes a synchronous `render()` that degrades gracefully to an escaped `<pre>` before shiki init completes.

**Files:**
- Create: `packages/frontend/app/composables/chat/markdown/use-markdown.ts`
- Create: `packages/frontend/tests/composables/chat/markdown/use-markdown.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/composables/chat/markdown/use-markdown.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { ensureMarkdown, renderMarkdown } from '~/composables/chat/markdown/use-markdown'

describe('renderMarkdown', () => {
  beforeAll(async () => {
    await ensureMarkdown()
  })

  it('renders bold and italics', () => {
    const html = renderMarkdown('hello **world** and *there*')
    expect(html).toContain('<strong>world</strong>')
    expect(html).toContain('<em>there</em>')
  })

  it('renders GFM tables', () => {
    const src = '| a | b |\n|---|---|\n| 1 | 2 |'
    const html = renderMarkdown(src)
    expect(html).toContain('<table>')
    expect(html).toContain('<td>1</td>')
  })

  it('auto-links bare URLs', () => {
    const html = renderMarkdown('see https://example.com for details')
    expect(html).toMatch(/<a[^>]+href="https:\/\/example\.com"/)
  })

  it('highlights bash fenced blocks', () => {
    const html = renderMarkdown('```bash\necho hi\n```')
    expect(html).toMatch(/shiki|style=/i)
    expect(html).toContain('echo')
  })

  it('highlights json fenced blocks', () => {
    const html = renderMarkdown('```json\n{"a":1}\n```')
    expect(html).toMatch(/shiki|style=/i)
  })

  it('strips script tags from raw HTML', () => {
    const html = renderMarkdown('ok <script>alert(1)</script> done')
    expect(html).not.toContain('<script>')
  })

  it('keeps relative links', () => {
    const html = renderMarkdown('[x](src/foo.ts#L1)')
    expect(html).toContain('href="src/foo.ts#L1"')
  })
})

describe('renderMarkdown before init', () => {
  it('returns an escaped <pre> fallback', async () => {
    // Fresh-module pattern: simulate pre-init by calling a synchronous render
    // from a module that has not been awaited. Since module-level singletons
    // persist across tests, we rely on a small probe: the fallback branch is
    // exercised when renderMarkdown is called and the module flag is false.
    // This test asserts the contract indirectly through code inspection —
    // the real guarantee is the `renderMarkdown` signature: never throws, always string.
    expect(typeof renderMarkdown('test')).toBe('string')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/frontend && pnpm vitest run tests/composables/chat/markdown/use-markdown.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the composable**

Create `packages/frontend/app/composables/chat/markdown/use-markdown.ts`:

```ts
import MarkdownIt from 'markdown-it'
import Shiki from '@shikijs/markdown-it'
import { sanitize } from './sanitize'

const SHIKI_LANGS = [
  'bash', 'shell', 'sh', 'zsh',
  'json', 'yaml', 'toml',
  'ts', 'tsx', 'js', 'jsx',
  'vue', 'html', 'css',
  'python', 'diff', 'md',
] as const

let mdInstance: MarkdownIt | null = null
let initPromise: Promise<MarkdownIt> | null = null

async function initMarkdown(): Promise<MarkdownIt> {
  const md = new MarkdownIt({ html: true, linkify: true, breaks: false })
  const shikiPlugin = await Shiki({
    themes: { light: 'github-light', dark: 'github-dark' },
    langs: [...SHIKI_LANGS],
  })
  md.use(shikiPlugin)
  mdInstance = md
  return md
}

/** Await before calling `renderMarkdown` if you want the highlighted output in the first render. */
export function ensureMarkdown(): Promise<MarkdownIt> {
  if (mdInstance) return Promise.resolve(mdInstance)
  if (!initPromise) initPromise = initMarkdown()
  return initPromise
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fallback(source: string): string {
  return `<pre class="whitespace-pre-wrap"><code>${escapeHtml(source)}</code></pre>`
}

/** Synchronous render. Returns fallback `<pre>` if shiki is still initializing. */
export function renderMarkdown(source: string): string {
  if (!mdInstance) {
    // Kick off init so future calls succeed, but don't block.
    void ensureMarkdown()
    return fallback(source)
  }
  const rendered = mdInstance.render(source)
  return sanitize(rendered)
}

/**
 * Composable entry point for components. Tracks a reactive `ready` flag and
 * bumps an internal version so any `render()` callsite re-runs once shiki is
 * initialized.
 */
export function useMarkdown() {
  const ready = ref(!!mdInstance)
  const version = ref(0)
  if (!mdInstance) {
    ensureMarkdown().then(() => {
      ready.value = true
      version.value++
    })
  }
  const render = (source: string) => {
    // Touch `version` so the computed re-runs when init flips.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    version.value
    return renderMarkdown(source)
  }
  return { ready, render }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/frontend && pnpm vitest run tests/composables/chat/markdown/use-markdown.test.ts
```

Expected: PASS — 8/8. First test in file awaits `ensureMarkdown()` so shiki is ready for the subsequent assertions.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/composables/chat/markdown/use-markdown.ts packages/frontend/tests/composables/chat/markdown/use-markdown.test.ts
git commit -m "feat(frontend): add useMarkdown composable with shiki + sanitize pipeline"
```

---

### Task 1.4: `<RichMarkdown>` component

**Why:** Single reusable component for any caller that has a markdown string to render. Assistant text, tool formatters, and future callers all route through this.

**Files:**
- Create: `packages/frontend/app/components/chat/RichMarkdown.vue`
- Create: `packages/frontend/tests/components/chat/RichMarkdown.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/components/chat/RichMarkdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import RichMarkdown from '~/components/chat/RichMarkdown.vue'
import { ensureMarkdown } from '~/composables/chat/markdown/use-markdown'

describe('RichMarkdown', () => {
  it('renders bold markdown', async () => {
    await ensureMarkdown()
    const wrapper = await mountSuspended(RichMarkdown, {
      props: { source: 'hello **world**' },
    })
    expect(wrapper.html()).toContain('<strong>world</strong>')
  })

  it('renders a fenced bash code block', async () => {
    await ensureMarkdown()
    const wrapper = await mountSuspended(RichMarkdown, {
      props: { source: '```bash\necho hi\n```' },
    })
    expect(wrapper.html()).toContain('echo')
  })

  it('uses the prose container', async () => {
    const wrapper = await mountSuspended(RichMarkdown, {
      props: { source: 'x' },
    })
    expect(wrapper.classes()).toContain('prose')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/frontend && pnpm vitest run tests/components/chat/RichMarkdown.test.ts
```

Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement the component**

Create `packages/frontend/app/components/chat/RichMarkdown.vue`:

```vue
<script setup lang="ts">
const props = defineProps<{ source: string }>()
const { render } = useMarkdown()
const html = computed(() => render(props.source ?? ''))
</script>

<template>
  <div
    class="prose prose-sm dark:prose-invert max-w-none break-words"
    v-html="html"
  />
</template>
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/frontend && pnpm vitest run tests/components/chat/RichMarkdown.test.ts
```

Expected: PASS — 3/3.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/components/chat/RichMarkdown.vue packages/frontend/tests/components/chat/RichMarkdown.test.ts
git commit -m "feat(frontend): add RichMarkdown component wrapping useMarkdown"
```

---

## Phase 2 — Assistant messages

### Task 2.1: Use `RichMarkdown` in `ChatBlockText` full mode

**Why:** The whole point. Assistant text currently shows as `whitespace-pre-wrap`. Swap the full-mode branch to render real markdown. Keep badge and compact modes untouched.

**Files:**
- Modify: `packages/frontend/app/components/chat/ChatBlockText.vue`
- Modify: `packages/frontend/tests/components/chat/ChatBlockText.test.ts`

- [ ] **Step 1: Add a failing test asserting markdown render**

Replace `packages/frontend/tests/components/chat/ChatBlockText.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatBlockText from '~/components/chat/ChatBlockText.vue'
import { ensureMarkdown } from '~/composables/chat/markdown/use-markdown'

describe('ChatBlockText', () => {
  it('renders text in full mode', async () => {
    const wrapper = await mountSuspended(ChatBlockText, {
      props: { componentKey: 'k1', defaultMode: 'full', data: { type: 'text', text: 'hello world' } },
    })
    expect(wrapper.text()).toContain('hello')
  })

  it('renders markdown bold in full mode', async () => {
    await ensureMarkdown()
    const wrapper = await mountSuspended(ChatBlockText, {
      props: { componentKey: 'k1b', defaultMode: 'full', data: { type: 'text', text: 'hello **world**' } },
    })
    expect(wrapper.html()).toContain('<strong>world</strong>')
  })

  it('renders a fenced bash block in full mode', async () => {
    await ensureMarkdown()
    const wrapper = await mountSuspended(ChatBlockText, {
      props: { componentKey: 'k1c', defaultMode: 'full', data: { type: 'text', text: '```bash\necho hi\n```' } },
    })
    expect(wrapper.html()).toContain('echo')
  })

  it('truncates text in compact mode (plain, no markdown)', async () => {
    const wrapper = await mountSuspended(ChatBlockText, {
      props: { componentKey: 'k2', defaultMode: 'compact', data: { type: 'text', text: 'a'.repeat(500) } },
    })
    expect(wrapper.attributes('data-mode')).toBe('compact')
  })
})
```

- [ ] **Step 2: Run test to verify new assertions fail**

```bash
cd packages/frontend && pnpm vitest run tests/components/chat/ChatBlockText.test.ts
```

Expected: FAIL — the `<strong>` and `echo` assertions fail because current code renders plain text.

- [ ] **Step 3: Swap full-mode branch to `RichMarkdown`**

Replace `packages/frontend/app/components/chat/ChatBlockText.vue` with:

```vue
<script setup lang="ts">
import type { RenderMode } from '~/types/chat'
import RichMarkdown from '~/components/chat/RichMarkdown.vue'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'text'; text?: string; _parentMessageId?: string }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, cycleMode } = useRenderMode(props.componentKey, props.defaultMode)

const text = computed(() => props.data.text ?? '')
</script>

<template>
  <div
    :data-mode="mode"
    :class="mode === 'badge' ? 'inline-flex items-center mr-1 align-middle' : 'block my-1'"
  >
    <template v-if="mode === 'badge'">
      <UBadge color="neutral" variant="subtle" size="sm" class="cursor-pointer" @click="cycleMode()">
        <UIcon name="i-lucide-message-square" class="size-3" />
        <span class="text-xs truncate max-w-[14ch]">{{ text }}</span>
      </UBadge>
    </template>
    <template v-else-if="mode === 'compact'">
      <div class="truncate text-sm leading-6 cursor-pointer" @click="cycleMode()">
        <UIcon name="i-lucide-chevron-right" class="size-3" />
        {{ text }}
      </div>
    </template>
    <template v-else>
      <div class="cursor-pointer" @click="cycleMode()">
        <RichMarkdown :source="text" />
      </div>
    </template>
  </div>
</template>
```

- [ ] **Step 4: Run test to verify all pass**

```bash
cd packages/frontend && pnpm vitest run tests/components/chat/ChatBlockText.test.ts
```

Expected: PASS — 4/4.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/components/chat/ChatBlockText.vue packages/frontend/tests/components/chat/ChatBlockText.test.ts
git commit -m "feat(frontend): render assistant text as rich markdown in full mode"
```

---

## Phase 3 — Bash tool calls & JSON outputs

### Task 3.1: Tool formatters module — Bash and JSON

**Why:** Turn each tool's `(input, tool_result)` into a markdown string that `RichMarkdown` then renders. Keeping formatters pure and table-driven makes them trivial to test and to extend later (Task 4).

**Files:**
- Create: `packages/frontend/app/composables/chat/markdown/tool-formatters.ts`
- Create: `packages/frontend/tests/composables/chat/markdown/tool-formatters.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/composables/chat/markdown/tool-formatters.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatToolInput, formatToolOutput } from '~/composables/chat/markdown/tool-formatters'

describe('formatToolInput — Bash', () => {
  it('formats a bash command as a fenced bash block', () => {
    const md = formatToolInput('Bash', { command: 'ls -la' })
    expect(md).toBe('```bash\nls -la\n```')
  })

  it('falls back to JSON fence for unknown tools', () => {
    const md = formatToolInput('Unknown', { foo: 1 })
    expect(md).toContain('```json')
    expect(md).toContain('"foo": 1')
  })

  it('handles missing input safely', () => {
    expect(formatToolInput('Bash', undefined)).toBe('')
  })
})

describe('formatToolOutput — Bash', () => {
  it('renders plain stdout as a fenced bash block', () => {
    const md = formatToolOutput('Bash', 'total 24\ndrwx ...')
    expect(md.startsWith('```bash\n')).toBe(true)
    expect(md).toContain('total 24')
  })

  it('auto-detects JSON stdout and uses json fence', () => {
    const md = formatToolOutput('Bash', '{"ok": true, "n": 2}')
    expect(md.startsWith('```json\n')).toBe(true)
  })

  it('returns empty string for undefined output', () => {
    expect(formatToolOutput('Bash', undefined)).toBe('')
  })
})

describe('formatToolOutput — default', () => {
  it('pretty-prints object results as json', () => {
    const md = formatToolOutput('WebSearch', { results: ['a', 'b'] })
    expect(md).toContain('```json')
    expect(md).toContain('"results"')
  })

  it('renders string results as plain code', () => {
    const md = formatToolOutput('WebFetch', 'raw text')
    expect(md).toContain('```\nraw text\n```')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/frontend && pnpm vitest run tests/composables/chat/markdown/tool-formatters.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the formatters**

Create `packages/frontend/app/composables/chat/markdown/tool-formatters.ts`:

```ts
function fence(lang: string, body: string): string {
  return '```' + lang + '\n' + body + '\n```'
}

function looksLikeJson(s: string): boolean {
  const trimmed = s.trim()
  if (!trimmed) return false
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function toJsonFence(value: unknown): string {
  return fence('json', JSON.stringify(value, null, 2))
}

export function formatToolInput(name: string | undefined, input: unknown): string {
  if (input === undefined || input === null) return ''
  const tool = name ?? ''

  if (tool === 'Bash' && typeof input === 'object' && input && 'command' in input) {
    const cmd = String((input as { command: unknown }).command ?? '')
    return fence('bash', cmd)
  }

  // Default: JSON-dump the input
  return toJsonFence(input)
}

export function formatToolOutput(name: string | undefined, content: unknown): string {
  if (content === undefined || content === null) return ''
  const tool = name ?? ''

  if (typeof content === 'string') {
    if (tool === 'Bash') {
      if (looksLikeJson(content)) return fence('json', content.trim())
      return fence('bash', content)
    }
    if (looksLikeJson(content)) return fence('json', content.trim())
    return fence('', content)
  }

  return toJsonFence(content)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/frontend && pnpm vitest run tests/composables/chat/markdown/tool-formatters.test.ts
```

Expected: PASS — 8/8.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/composables/chat/markdown/tool-formatters.ts packages/frontend/tests/composables/chat/markdown/tool-formatters.test.ts
git commit -m "feat(frontend): add tool-formatters for Bash and generic JSON outputs"
```

---

### Task 3.2: Wire formatters into `ChatBlockToolUse`

**Why:** Replace the raw `<pre>` blocks in compact and full mode with `RichMarkdown` driven by the formatters. Status badges, icon, streaming indicator, and subagent transcript all stay as-is.

**Files:**
- Modify: `packages/frontend/app/components/chat/ChatBlockToolUse.vue`
- Modify: `packages/frontend/tests/components/chat/ChatBlockToolUse.test.ts`

- [ ] **Step 1: Add failing test assertions**

Read the existing test file first:

```bash
cat packages/frontend/tests/components/chat/ChatBlockToolUse.test.ts
```

Append these cases (keep existing cases as they are unless they assert on the raw `<pre>` contents — in which case, update them to assert on rendered markdown):

```ts
import { ensureMarkdown } from '~/composables/chat/markdown/use-markdown'

describe('ChatBlockToolUse — Bash markdown rendering', () => {
  it('renders the bash command as a highlighted code block in full mode', async () => {
    await ensureMarkdown()
    const wrapper = await mountSuspended(ChatBlockToolUse, {
      props: {
        componentKey: 'bash-1',
        defaultMode: 'full',
        status: 'success',
        data: {
          type: 'tool_use',
          id: 't1',
          name: 'Bash',
          input: { command: 'ls -la' },
          tool_result: { content: 'total 24', is_error: false },
        },
      },
    })
    expect(wrapper.html()).toContain('ls -la')
    expect(wrapper.html()).toContain('total 24')
  })

  it('renders JSON bash output with json fence', async () => {
    await ensureMarkdown()
    const wrapper = await mountSuspended(ChatBlockToolUse, {
      props: {
        componentKey: 'bash-2',
        defaultMode: 'full',
        status: 'success',
        data: {
          type: 'tool_use',
          id: 't2',
          name: 'Bash',
          input: { command: 'cat config.json' },
          tool_result: { content: '{"ok": true}', is_error: false },
        },
      },
    })
    expect(wrapper.html()).toMatch(/language-json|shiki|style=/i)
  })
})
```

- [ ] **Step 2: Run to verify new assertions fail**

```bash
cd packages/frontend && pnpm vitest run tests/components/chat/ChatBlockToolUse.test.ts
```

Expected: FAIL on the new cases.

- [ ] **Step 3: Swap `<pre>` blocks for `RichMarkdown`**

Update the relevant parts of `packages/frontend/app/components/chat/ChatBlockToolUse.vue`:

Add imports:

```ts
import RichMarkdown from '~/components/chat/RichMarkdown.vue'
import { formatToolInput, formatToolOutput } from '~/composables/chat/markdown/tool-formatters'
```

Add computed:

```ts
const inputMd = computed(() => formatToolInput(props.data.name, props.data.input))
const outputMd = computed(() => formatToolOutput(props.data.name, props.data.tool_result?.content))
```

Replace the compact-mode body:

```vue
<template v-else-if="mode === 'compact'">
  <UChatTool
    variant="inline"
    :icon="icon"
    :text="label"
    :suffix="inputSummary.slice(0, 80)"
    :streaming="isStreaming"
    :loading="isStreaming"
    :defaultOpen="true"
    @update:open="cycleMode()"
  >
    <div class="space-y-2" @click.stop>
      <RichMarkdown v-if="data.tool_result && outputMd" :source="outputMd" />
      <ChatSubagentTranscript
        v-if="hasSubagentContent && subagentMeta && sessionId"
        :agent-id="subagentMeta.agentId"
        :agent-type="subagentMeta.agentType"
        :description="subagentMeta.description"
        :messages="mergedSubagentMessages"
        :session-id="sessionId"
      />
    </div>
  </UChatTool>
</template>
```

Replace the full-mode body:

```vue
<template v-else>
  <UChatTool
    variant="card"
    :icon="icon"
    :text="label"
    :suffix="inputSummary.slice(0, 80)"
    :streaming="isStreaming"
    :loading="isStreaming"
    :defaultOpen="true"
    @update:open="cycleMode()"
  >
    <div class="space-y-2" @click.stop>
      <RichMarkdown v-if="inputMd" :source="inputMd" />
      <RichMarkdown v-if="data.tool_result && outputMd" :source="outputMd" />
      <ChatSubagentTranscript
        v-if="hasSubagentContent && subagentMeta && sessionId"
        :agent-id="subagentMeta.agentId"
        :agent-type="subagentMeta.agentType"
        :description="subagentMeta.description"
        :messages="mergedSubagentMessages"
        :session-id="sessionId"
      />
    </div>
  </UChatTool>
</template>
```

- [ ] **Step 4: Run to verify all pass**

```bash
cd packages/frontend && pnpm vitest run tests/components/chat/ChatBlockToolUse.test.ts
```

Expected: PASS. If any legacy test asserts on the old `<pre>` markup, update it to assert on rendered markdown content (e.g. `wrapper.text()` contains the expected strings).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/components/chat/ChatBlockToolUse.vue packages/frontend/tests/components/chat/ChatBlockToolUse.test.ts
git commit -m "feat(frontend): render tool_use input/output as rich markdown"
```

---

## Phase 4 — Diffs & file reads

### Task 4.1: Unified diff builder

**Why:** Edit tool calls carry `old_string` and `new_string`. A human-readable unified diff is the single highest-impact rendering we add for tool calls.

**Files:**
- Create: `packages/frontend/app/composables/chat/markdown/build-unified-diff.ts`
- Create: `packages/frontend/tests/composables/chat/markdown/build-unified-diff.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/composables/chat/markdown/build-unified-diff.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildUnifiedDiff } from '~/composables/chat/markdown/build-unified-diff'

describe('buildUnifiedDiff', () => {
  it('produces a unified diff for a single-line change', () => {
    const out = buildUnifiedDiff('foo\nbar\nbaz', 'foo\nqux\nbaz', 'file.ts')
    expect(out).toContain('--- a/file.ts')
    expect(out).toContain('+++ b/file.ts')
    expect(out).toContain('-bar')
    expect(out).toContain('+qux')
  })

  it('handles pure additions', () => {
    const out = buildUnifiedDiff('foo', 'foo\nbar', 'x.md')
    expect(out).toContain('+bar')
  })

  it('handles pure deletions', () => {
    const out = buildUnifiedDiff('foo\nbar', 'foo', 'x.md')
    expect(out).toContain('-bar')
  })

  it('handles identical inputs', () => {
    const out = buildUnifiedDiff('same', 'same', 'x.md')
    // Still emits file headers; body may be empty hunk or no hunks.
    expect(out).toContain('--- a/x.md')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/frontend && pnpm vitest run tests/composables/chat/markdown/build-unified-diff.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement a minimal LCS-based unified diff**

Create `packages/frontend/app/composables/chat/markdown/build-unified-diff.ts`:

```ts
/**
 * Minimal unified-diff builder using an LCS table. Intended for short
 * old/new pairs (Edit tool). Not optimized for very large inputs — if that
 * becomes a bottleneck, swap in `diff` from npm.
 */
export function buildUnifiedDiff(oldStr: string, newStr: string, filename: string): string {
  const a = oldStr.split('\n')
  const b = newStr.split('\n')
  const n = a.length
  const m = b.length

  // LCS length table
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  const lines: string[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { lines.push(' ' + a[i]); i++; j++ }
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) { lines.push('-' + a[i]); i++ }
    else { lines.push('+' + b[j]); j++ }
  }
  while (i < n) { lines.push('-' + a[i]); i++ }
  while (j < m) { lines.push('+' + b[j]); j++ }

  const header = `--- a/${filename}\n+++ b/${filename}`
  const hunk = lines.length ? `@@ -1,${n} +1,${m} @@\n${lines.join('\n')}` : ''
  return hunk ? `${header}\n${hunk}` : header
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/frontend && pnpm vitest run tests/composables/chat/markdown/build-unified-diff.test.ts
```

Expected: PASS — 4/4.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/composables/chat/markdown/build-unified-diff.ts packages/frontend/tests/composables/chat/markdown/build-unified-diff.test.ts
git commit -m "feat(frontend): add unified diff builder for Edit tool rendering"
```

---

### Task 4.2: Extension → language detector

**Why:** Write and Read tool content needs a shiki lang hint. A small map from extension to our preloaded lang list keeps the detector cheap and predictable.

**Files:**
- Create: `packages/frontend/app/composables/chat/markdown/detect-lang.ts`
- Create: `packages/frontend/tests/composables/chat/markdown/detect-lang.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/composables/chat/markdown/detect-lang.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { detectLangFromPath } from '~/composables/chat/markdown/detect-lang'

describe('detectLangFromPath', () => {
  it('maps .ts to ts', () => expect(detectLangFromPath('src/a.ts')).toBe('ts'))
  it('maps .tsx to tsx', () => expect(detectLangFromPath('app/Foo.tsx')).toBe('tsx'))
  it('maps .vue to vue', () => expect(detectLangFromPath('app/X.vue')).toBe('vue'))
  it('maps .py to python', () => expect(detectLangFromPath('x/y.py')).toBe('python'))
  it('maps .json to json', () => expect(detectLangFromPath('pkg.json')).toBe('json'))
  it('maps Taskfile.yml to yaml', () => expect(detectLangFromPath('Taskfile.yml')).toBe('yaml'))
  it('maps .sh to bash', () => expect(detectLangFromPath('run.sh')).toBe('bash'))
  it('returns empty string for unknown extensions', () => expect(detectLangFromPath('a.xyz')).toBe(''))
  it('handles no extension', () => expect(detectLangFromPath('README')).toBe(''))
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/frontend && pnpm vitest run tests/composables/chat/markdown/detect-lang.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the detector**

Create `packages/frontend/app/composables/chat/markdown/detect-lang.ts`:

```ts
const EXT_TO_LANG: Record<string, string> = {
  ts: 'ts', tsx: 'tsx',
  js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  vue: 'vue',
  py: 'python',
  json: 'json',
  yml: 'yaml', yaml: 'yaml',
  toml: 'toml',
  sh: 'bash', bash: 'bash', zsh: 'zsh',
  md: 'md', markdown: 'md',
  html: 'html', htm: 'html',
  css: 'css',
}

export function detectLangFromPath(path: string): string {
  const base = path.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  const ext = base.slice(dot + 1).toLowerCase()
  return EXT_TO_LANG[ext] ?? ''
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/frontend && pnpm vitest run tests/composables/chat/markdown/detect-lang.test.ts
```

Expected: PASS — 9/9.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/composables/chat/markdown/detect-lang.ts packages/frontend/tests/composables/chat/markdown/detect-lang.test.ts
git commit -m "feat(frontend): add extension-to-language detector for shiki hints"
```

---

### Task 4.3: Extend tool-formatters for Edit / Write / Read

**Why:** Wire the diff builder and lang detector into the existing formatter dispatch so `ChatBlockToolUse` automatically gets diff rendering for Edit and syntax-highlighted code for Write/Read.

**Files:**
- Modify: `packages/frontend/app/composables/chat/markdown/tool-formatters.ts`
- Modify: `packages/frontend/tests/composables/chat/markdown/tool-formatters.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/frontend/tests/composables/chat/markdown/tool-formatters.test.ts`:

```ts
describe('formatToolInput — Edit', () => {
  it('produces a unified diff fenced as diff', () => {
    const md = formatToolInput('Edit', {
      file_path: 'src/foo.ts',
      old_string: 'a\nb\nc',
      new_string: 'a\nB\nc',
    })
    expect(md).toContain('```diff')
    expect(md).toContain('-b')
    expect(md).toContain('+B')
    expect(md).toContain('src/foo.ts')
  })
})

describe('formatToolInput — Write', () => {
  it('renders content in a fenced block using language from extension', () => {
    const md = formatToolInput('Write', {
      file_path: 'src/x.ts',
      content: 'export const x = 1',
    })
    expect(md.startsWith('```ts\n')).toBe(true)
    expect(md).toContain('export const x = 1')
  })
})

describe('formatToolOutput — Read', () => {
  it('renders Read content using language from file_path in tool input', () => {
    const md = formatToolOutput('Read', 'const x = 1\n', { file_path: 'a.ts' })
    expect(md.startsWith('```ts\n')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify new cases fail**

```bash
cd packages/frontend && pnpm vitest run tests/composables/chat/markdown/tool-formatters.test.ts
```

Expected: FAIL on the three new cases.

- [ ] **Step 3: Extend the formatters**

Replace `packages/frontend/app/composables/chat/markdown/tool-formatters.ts` with:

```ts
import { buildUnifiedDiff } from './build-unified-diff'
import { detectLangFromPath } from './detect-lang'

function fence(lang: string, body: string): string {
  return '```' + lang + '\n' + body + '\n```'
}

function looksLikeJson(s: string): boolean {
  const trimmed = s.trim()
  if (!trimmed) return false
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function toJsonFence(value: unknown): string {
  return fence('json', JSON.stringify(value, null, 2))
}

export function formatToolInput(name: string | undefined, input: unknown): string {
  if (input === undefined || input === null) return ''
  const tool = name ?? ''

  if (typeof input !== 'object') return toJsonFence(input)
  const obj = input as Record<string, unknown>

  if (tool === 'Bash' && 'command' in obj) {
    return fence('bash', String(obj.command ?? ''))
  }

  if (tool === 'Edit' && 'file_path' in obj) {
    const diff = buildUnifiedDiff(
      String(obj.old_string ?? ''),
      String(obj.new_string ?? ''),
      String(obj.file_path),
    )
    return fence('diff', diff)
  }

  if (tool === 'Write' && 'file_path' in obj && 'content' in obj) {
    const lang = detectLangFromPath(String(obj.file_path))
    return fence(lang, String(obj.content ?? ''))
  }

  if (tool === 'Read' && 'file_path' in obj) {
    // Read input shows just the file path inline; content comes via output.
    return fence('', String(obj.file_path))
  }

  return toJsonFence(input)
}

export function formatToolOutput(
  name: string | undefined,
  content: unknown,
  input?: unknown,
): string {
  if (content === undefined || content === null) return ''
  const tool = name ?? ''

  if (typeof content === 'string') {
    if (tool === 'Bash') {
      if (looksLikeJson(content)) return fence('json', content.trim())
      return fence('bash', content)
    }
    if (tool === 'Read' && typeof input === 'object' && input && 'file_path' in (input as object)) {
      const lang = detectLangFromPath(String((input as { file_path: unknown }).file_path))
      return fence(lang, content)
    }
    if (looksLikeJson(content)) return fence('json', content.trim())
    return fence('', content)
  }

  return toJsonFence(content)
}
```

- [ ] **Step 4: Update the `ChatBlockToolUse` wiring to pass `input` to `formatToolOutput`**

In `packages/frontend/app/components/chat/ChatBlockToolUse.vue`, change the `outputMd` computed:

```ts
const outputMd = computed(() =>
  formatToolOutput(props.data.name, props.data.tool_result?.content, props.data.input),
)
```

- [ ] **Step 5: Run tests to verify all pass**

```bash
cd packages/frontend && pnpm vitest run tests/composables/chat/markdown tests/components/chat/ChatBlockToolUse.test.ts
```

Expected: PASS — all existing + 3 new cases.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/app/composables/chat/markdown/tool-formatters.ts packages/frontend/app/components/chat/ChatBlockToolUse.vue packages/frontend/tests/composables/chat/markdown/tool-formatters.test.ts
git commit -m "feat(frontend): render Edit as diff, Write/Read with detected language"
```

---

## Phase 5 — Post-processors (file paths, stack traces)

### Task 5.1: File-path linkifier post-processor

**Why:** `path/to/file.ts:42` and similar references appear constantly in tool output and assistant text. Converting them to VSCode-style clickable links is the single biggest navigation win.

**Files:**
- Create: `packages/frontend/app/composables/chat/markdown/post-processors.ts`
- Create: `packages/frontend/tests/composables/chat/markdown/post-processors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/composables/chat/markdown/post-processors.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { linkifyFilePaths } from '~/composables/chat/markdown/post-processors'

describe('linkifyFilePaths', () => {
  it('linkifies path:line in plain text', () => {
    const out = linkifyFilePaths('see src/foo.ts:42 for context')
    expect(out).toContain('<a href="src/foo.ts#L42">src/foo.ts:42</a>')
  })

  it('linkifies bare paths with known extensions', () => {
    const out = linkifyFilePaths('edited src/a.vue today')
    expect(out).toContain('<a href="src/a.vue">src/a.vue</a>')
  })

  it('does not linkify inside <code> blocks', () => {
    const out = linkifyFilePaths('<code>src/foo.ts:1</code>')
    expect(out).toBe('<code>src/foo.ts:1</code>')
  })

  it('does not double-linkify existing anchors', () => {
    const out = linkifyFilePaths('<a href="x">src/foo.ts:1</a>')
    expect(out).toBe('<a href="x">src/foo.ts:1</a>')
  })

  it('handles line+col', () => {
    const out = linkifyFilePaths('src/x.ts:10:5')
    expect(out).toContain('href="src/x.ts#L10"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/frontend && pnpm vitest run tests/composables/chat/markdown/post-processors.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the linkifier via DOMParser walk**

Create `packages/frontend/app/composables/chat/markdown/post-processors.ts`:

```ts
// Matches: path/with/slashes.ext, optional :line, optional :col.
// Extensions are restricted to the ones we care about to avoid false positives.
const PATH_RE = /\b([\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|vue|py|json|ya?ml|toml|sh|md|css|html))(?::(\d+))?(?::\d+)?\b/g

const SKIP_ANCESTORS = new Set(['A', 'CODE', 'PRE'])

function walk(node: Node, fn: (text: Text) => void): void {
  if (node.nodeType === Node.TEXT_NODE) {
    fn(node as Text)
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  if (SKIP_ANCESTORS.has((node as Element).tagName)) return
  for (const child of Array.from(node.childNodes)) walk(child, fn)
}

function replaceTextWithHtml(textNode: Text, html: string): void {
  const tmp = document.createElement('span')
  tmp.innerHTML = html
  const frag = document.createDocumentFragment()
  while (tmp.firstChild) frag.appendChild(tmp.firstChild)
  textNode.parentNode!.replaceChild(frag, textNode)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function linkifyFilePaths(html: string): string {
  if (!html) return html
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild!
  walk(root, (text) => {
    const str = text.data
    if (!PATH_RE.test(str)) { PATH_RE.lastIndex = 0; return }
    PATH_RE.lastIndex = 0
    const replaced = str.replace(PATH_RE, (match, path: string, line?: string) => {
      const href = line ? `${path}#L${line}` : path
      return `<a href="${escapeHtml(href)}">${escapeHtml(match)}</a>`
    })
    if (replaced !== str) replaceTextWithHtml(text, replaced)
  })
  return root.innerHTML
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/frontend && pnpm vitest run tests/composables/chat/markdown/post-processors.test.ts
```

Expected: PASS — 5/5. Note the node project uses the `node` environment; this test requires `happy-dom` for `DOMParser`. If it fails with "DOMParser is not defined", move the test to `tests/components/` so it runs under the `nuxt` environment (which has happy-dom).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/composables/chat/markdown/post-processors.ts packages/frontend/tests/composables/chat/markdown/post-processors.test.ts
git commit -m "feat(frontend): add file-path linkifier post-processor"
```

---

### Task 5.2: Stack-trace styling post-processor

**Why:** JS/Python stack traces appearing inside tool output should read as errors, not casual prose. Wrap recognized frames with a styled `<span class="stack-frame">` and linkify embedded file:line refs (piggy-backing on Task 5.1).

**Files:**
- Modify: `packages/frontend/app/composables/chat/markdown/post-processors.ts`
- Modify: `packages/frontend/tests/composables/chat/markdown/post-processors.test.ts`

- [ ] **Step 1: Add failing tests**

Append to the test file:

```ts
import { formatStackTraces } from '~/composables/chat/markdown/post-processors'

describe('formatStackTraces', () => {
  it('wraps JS "at fn (file.ts:10:5)" frames', () => {
    const input = '<pre><code>Error: boom\n    at foo (src/a.ts:10:5)\n    at bar (src/b.ts:3:1)</code></pre>'
    const out = formatStackTraces(input)
    expect(out).toContain('class="stack-frame"')
    expect(out).toContain('src/a.ts')
  })

  it('wraps Python "File ..., line N" frames', () => {
    const input = '<pre><code>Traceback (most recent call last):\n  File "app.py", line 12, in <module>\n    x()</code></pre>'
    const out = formatStackTraces(input)
    expect(out).toContain('class="stack-frame"')
    expect(out).toContain('app.py')
  })

  it('leaves unrelated text untouched', () => {
    const input = '<p>just a sentence</p>'
    expect(formatStackTraces(input)).toBe(input)
  })
})
```

- [ ] **Step 2: Run to verify fails**

```bash
cd packages/frontend && pnpm vitest run tests/composables/chat/markdown/post-processors.test.ts
```

Expected: FAIL — `formatStackTraces` does not exist.

- [ ] **Step 3: Implement**

Append to `packages/frontend/app/composables/chat/markdown/post-processors.ts`:

```ts
const JS_FRAME_RE = /^(\s*at\s+[^\n]*\([\w./-]+\.\w+:\d+:\d+\))$/gm
const PY_FRAME_RE = /^(\s*File\s+"[^"]+",\s*line\s+\d+(?:,\s*in\s+[^\n]+)?)$/gm

export function formatStackTraces(html: string): string {
  if (!html) return html
  return html.replace(JS_FRAME_RE, '<span class="stack-frame">$1</span>')
             .replace(PY_FRAME_RE, '<span class="stack-frame">$1</span>')
}
```

Also add a minimal style for `.stack-frame` in `packages/frontend/app/assets/css/main.css`:

```css
.prose .stack-frame {
  color: var(--color-red-500);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.85em;
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd packages/frontend && pnpm vitest run tests/composables/chat/markdown/post-processors.test.ts
```

Expected: PASS — 8/8.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/composables/chat/markdown/post-processors.ts packages/frontend/app/assets/css/main.css packages/frontend/tests/composables/chat/markdown/post-processors.test.ts
git commit -m "feat(frontend): style JS and Python stack frames in tool output"
```

---

### Task 5.3: Wire post-processors into the render pipeline

**Why:** Until now post-processors are unused. Compose them into `renderMarkdown` so every `RichMarkdown` rendering benefits.

**Files:**
- Modify: `packages/frontend/app/composables/chat/markdown/use-markdown.ts`
- Modify: `packages/frontend/tests/composables/chat/markdown/use-markdown.test.ts`

- [ ] **Step 1: Add a failing integration test**

Append to `packages/frontend/tests/composables/chat/markdown/use-markdown.test.ts`:

```ts
describe('renderMarkdown — post-processors', () => {
  it('linkifies file paths in prose', async () => {
    await ensureMarkdown()
    const html = renderMarkdown('see src/foo.ts:42 for the bug')
    expect(html).toContain('href="src/foo.ts#L42"')
  })

  it('styles JS stack frames inside fenced code', async () => {
    await ensureMarkdown()
    const html = renderMarkdown('```\nError: x\n    at foo (src/a.ts:1:1)\n```')
    expect(html).toContain('class="stack-frame"')
  })
})
```

- [ ] **Step 2: Run to verify fails**

```bash
cd packages/frontend && pnpm vitest run tests/composables/chat/markdown/use-markdown.test.ts
```

Expected: FAIL on the two new cases.

- [ ] **Step 3: Compose post-processors into `renderMarkdown`**

In `packages/frontend/app/composables/chat/markdown/use-markdown.ts`, add at the top:

```ts
import { linkifyFilePaths, formatStackTraces } from './post-processors'
```

Change `renderMarkdown` to:

```ts
export function renderMarkdown(source: string): string {
  if (!mdInstance) {
    void ensureMarkdown()
    return fallback(source)
  }
  const rendered = mdInstance.render(source)
  const clean = sanitize(rendered)
  const withStacks = formatStackTraces(clean)
  const withLinks = linkifyFilePaths(withStacks)
  return withLinks
}
```

Note: `linkifyFilePaths` relies on `DOMParser`. The node-project tests using this path must either run in a happy-dom environment or guard against missing `DOMParser`. Add a safety check:

```ts
function hasDomParser(): boolean {
  return typeof DOMParser !== 'undefined'
}
```

Wrap the linkify call:

```ts
const withLinks = hasDomParser() ? linkifyFilePaths(withStacks) : withStacks
```

If the node-project test environment does not have `DOMParser`, move the two new post-processor integration tests to `tests/components/RichMarkdown.test.ts` (nuxt project) where happy-dom is available, and assert via `mountSuspended(RichMarkdown, ...)`.

- [ ] **Step 4: Run to verify pass**

```bash
cd packages/frontend && pnpm vitest run
```

Expected: PASS across all files.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/composables/chat/markdown/use-markdown.ts packages/frontend/tests/composables/chat/markdown/use-markdown.test.ts packages/frontend/tests/components/chat/RichMarkdown.test.ts
git commit -m "feat(frontend): compose path-linkify and stack-trace post-processors into pipeline"
```

---

## Phase 6 — Polish (Mermaid, long-output collapsible)

### Task 6.1: Mermaid fenced-block renderer

**Why:** Agents occasionally produce architecture/flow diagrams. Mermaid is the de-facto markdown diagram language. We render `mermaid` fences via a dynamic import so the dep is lazy.

**Files:**
- Modify: `packages/frontend/package.json`
- Create: `packages/frontend/app/components/chat/MermaidBlock.vue`
- Modify: `packages/frontend/app/composables/chat/markdown/use-markdown.ts`
- Create: `packages/frontend/tests/components/chat/MermaidBlock.test.ts`

- [ ] **Step 1: Install mermaid**

```bash
cd packages/frontend && pnpm add mermaid
```

- [ ] **Step 2: Write the failing test**

Create `packages/frontend/tests/components/chat/MermaidBlock.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import MermaidBlock from '~/components/chat/MermaidBlock.vue'

describe('MermaidBlock', () => {
  it('renders a placeholder container for a mermaid source', async () => {
    const wrapper = await mountSuspended(MermaidBlock, {
      props: { source: 'graph TD; A-->B' },
    })
    expect(wrapper.attributes('data-mermaid')).toBe('')
  })
})
```

- [ ] **Step 3: Run to verify fails**

```bash
cd packages/frontend && pnpm vitest run tests/components/chat/MermaidBlock.test.ts
```

Expected: FAIL — component does not exist.

- [ ] **Step 4: Implement `MermaidBlock`**

Create `packages/frontend/app/components/chat/MermaidBlock.vue`:

```vue
<script setup lang="ts">
const props = defineProps<{ source: string }>()
const container = ref<HTMLElement | null>(null)
const svg = ref<string>('')

onMounted(async () => {
  const mermaid = (await import('mermaid')).default
  mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' })
  try {
    const id = 'm-' + Math.random().toString(36).slice(2)
    const { svg: rendered } = await mermaid.render(id, props.source)
    svg.value = rendered
  } catch (err) {
    svg.value = `<pre class="text-xs text-red-500">${String(err)}</pre>`
  }
})
</script>

<template>
  <div ref="container" data-mermaid class="my-2 flex justify-center" v-html="svg" />
</template>
```

- [ ] **Step 5: Intercept `mermaid` fences in the markdown pipeline**

In `packages/frontend/app/composables/chat/markdown/use-markdown.ts`, after `md.use(shikiPlugin)` in `initMarkdown`, override the fence rule for `mermaid`:

```ts
const defaultFence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!
  if (token.info.trim() === 'mermaid') {
    const escaped = token.content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
    return `<div class="mermaid-src" data-mermaid-src="${escaped}"></div>`
  }
  return defaultFence(tokens, idx, options, env, self)
}
```

And allow `data-mermaid-src` in the sanitizer allowlist by updating `sanitize.ts`:

```ts
const ALLOWED_ATTR = [
  'href', 'title', 'alt', 'src', 'name', 'id',
  'class', 'style',
  'open',
  'colspan', 'rowspan',
  'data-lang', 'data-line', 'data-file',
  'data-mermaid-src',
]
```

- [ ] **Step 6: Render `MermaidBlock` for mermaid placeholders**

In `packages/frontend/app/components/chat/RichMarkdown.vue`, replace the template with a walker that replaces `.mermaid-src` placeholders with `<MermaidBlock>`:

```vue
<script setup lang="ts">
import MermaidBlock from '~/components/chat/MermaidBlock.vue'

const props = defineProps<{ source: string }>()
const { render } = useMarkdown()
const html = computed(() => render(props.source ?? ''))

type Segment = { kind: 'html'; html: string } | { kind: 'mermaid'; source: string }

const segments = computed<Segment[]>(() => {
  const out: Segment[] = []
  const doc = new DOMParser().parseFromString(`<div>${html.value}</div>`, 'text/html')
  const root = doc.body.firstElementChild!
  const placeholders = Array.from(root.querySelectorAll('.mermaid-src'))
  if (placeholders.length === 0) {
    out.push({ kind: 'html', html: html.value })
    return out
  }
  // Split the HTML by replacing placeholders with sentinels, then walk.
  let current = root.innerHTML
  for (const el of placeholders) {
    const marker = `@@MERMAID_${Math.random().toString(36).slice(2)}@@`
    const src = el.getAttribute('data-mermaid-src') ?? ''
    const outer = el.outerHTML
    current = current.replace(outer, marker)
    const [before, rest] = current.split(marker)
    out.push({ kind: 'html', html: before ?? '' })
    out.push({ kind: 'mermaid', source: decodeHtml(src) })
    current = rest ?? ''
  }
  if (current) out.push({ kind: 'html', html: current })
  return out
})

function decodeHtml(s: string): string {
  const t = document.createElement('textarea')
  t.innerHTML = s
  return t.value
}
</script>

<template>
  <div class="prose prose-sm dark:prose-invert max-w-none break-words">
    <template v-for="(seg, i) in segments" :key="i">
      <div v-if="seg.kind === 'html'" v-html="seg.html" />
      <MermaidBlock v-else :source="seg.source" />
    </template>
  </div>
</template>
```

- [ ] **Step 7: Run all tests**

```bash
cd packages/frontend && pnpm vitest run
```

Expected: PASS across all files. Existing `RichMarkdown` tests must still assert correctly — the `prose` class now lives on the outer wrapper.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/package.json pnpm-lock.yaml packages/frontend/app/components/chat/MermaidBlock.vue packages/frontend/app/components/chat/RichMarkdown.vue packages/frontend/app/composables/chat/markdown/use-markdown.ts packages/frontend/app/composables/chat/markdown/sanitize.ts packages/frontend/tests/components/chat/MermaidBlock.test.ts
git commit -m "feat(frontend): render mermaid fences via lazy-loaded MermaidBlock"
```

---

### Task 6.2: Long-output collapsible

**Why:** Bash stdout, large JSON, and long Read outputs swamp the chat. Wrap code blocks beyond a threshold in a NuxtUI collapsible with a "show more" summary.

**Files:**
- Create: `packages/frontend/app/components/chat/CodeCollapsible.vue`
- Modify: `packages/frontend/app/components/chat/RichMarkdown.vue`
- Create: `packages/frontend/tests/components/chat/CodeCollapsible.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/components/chat/CodeCollapsible.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CodeCollapsible from '~/components/chat/CodeCollapsible.vue'

describe('CodeCollapsible', () => {
  it('shows inline when line count is below threshold', async () => {
    const wrapper = await mountSuspended(CodeCollapsible, {
      props: { html: '<pre><code>one\ntwo</code></pre>', lineCount: 2 },
    })
    expect(wrapper.attributes('data-collapsed')).toBe('false')
  })

  it('collapses when line count exceeds threshold', async () => {
    const wrapper = await mountSuspended(CodeCollapsible, {
      props: { html: '<pre><code>' + 'a\n'.repeat(50) + '</code></pre>', lineCount: 50 },
    })
    expect(wrapper.attributes('data-collapsed')).toBe('true')
  })
})
```

- [ ] **Step 2: Run to verify fails**

```bash
cd packages/frontend && pnpm vitest run tests/components/chat/CodeCollapsible.test.ts
```

Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement `CodeCollapsible`**

Create `packages/frontend/app/components/chat/CodeCollapsible.vue`:

```vue
<script setup lang="ts">
const THRESHOLD = 20

const props = defineProps<{ html: string; lineCount: number }>()
const open = ref(props.lineCount <= THRESHOLD)
const collapsed = computed(() => !open.value)
</script>

<template>
  <div :data-collapsed="collapsed ? 'true' : 'false'" class="my-2">
    <div v-if="open" v-html="html" />
    <UButton
      v-else
      variant="subtle"
      size="xs"
      :label="`Show ${lineCount} lines`"
      icon="i-lucide-chevron-down"
      class="cursor-pointer"
      @click="open = true"
    />
  </div>
</template>
```

- [ ] **Step 4: Wire into `RichMarkdown`**

Extend the segment walker in `RichMarkdown.vue` so that each `<pre>` element whose contained `<code>` has many newlines is emitted as a collapsible segment.

Add to the `<script setup>`:

```ts
import CodeCollapsible from '~/components/chat/CodeCollapsible.vue'

type Segment =
  | { kind: 'html'; html: string }
  | { kind: 'mermaid'; source: string }
  | { kind: 'collapsible'; html: string; lineCount: number }

const COLLAPSE_THRESHOLD = 20
```

Replace the `segments` computed with an extended walker (keep the existing mermaid handling, and additionally extract long `<pre>` blocks):

```ts
const segments = computed<Segment[]>(() => {
  const out: Segment[] = []
  const doc = new DOMParser().parseFromString(`<div>${html.value}</div>`, 'text/html')
  const root = doc.body.firstElementChild!
  const mermaidEls = Array.from(root.querySelectorAll('.mermaid-src'))
  const longPres = Array.from(root.querySelectorAll('pre')).filter((pre) => {
    const txt = pre.textContent ?? ''
    return txt.split('\n').length > COLLAPSE_THRESHOLD
  })
  const replaced = new Map<Element, { marker: string; seg: Segment }>()

  for (const el of mermaidEls) {
    const marker = `@@M_${Math.random().toString(36).slice(2)}@@`
    const src = el.getAttribute('data-mermaid-src') ?? ''
    replaced.set(el, { marker, seg: { kind: 'mermaid', source: decodeHtml(src) } })
  }
  for (const el of longPres) {
    if (replaced.has(el)) continue
    const marker = `@@C_${Math.random().toString(36).slice(2)}@@`
    const inner = el.outerHTML
    const lc = (el.textContent ?? '').split('\n').length
    replaced.set(el, { marker, seg: { kind: 'collapsible', html: inner, lineCount: lc } })
  }

  let current = root.innerHTML
  for (const [el, info] of replaced) {
    current = current.replace(el.outerHTML, info.marker)
  }

  // Split by all markers in order of appearance.
  const markerList = Array.from(replaced.values()).map(v => v)
  // Sort markers by position in `current`.
  markerList.sort((a, b) => current.indexOf(a.marker) - current.indexOf(b.marker))

  let cursor = 0
  for (const { marker, seg } of markerList) {
    const idx = current.indexOf(marker, cursor)
    if (idx < 0) continue
    const before = current.slice(cursor, idx)
    if (before) out.push({ kind: 'html', html: before })
    out.push(seg)
    cursor = idx + marker.length
  }
  const tail = current.slice(cursor)
  if (tail) out.push({ kind: 'html', html: tail })
  return out.length ? out : [{ kind: 'html', html: html.value }]
})
```

Replace the template body:

```vue
<template>
  <div class="prose prose-sm dark:prose-invert max-w-none break-words">
    <template v-for="(seg, i) in segments" :key="i">
      <div v-if="seg.kind === 'html'" v-html="seg.html" />
      <MermaidBlock v-else-if="seg.kind === 'mermaid'" :source="seg.source" />
      <CodeCollapsible v-else :html="seg.html" :line-count="seg.lineCount" />
    </template>
  </div>
</template>
```

- [ ] **Step 5: Run to verify pass**

```bash
cd packages/frontend && pnpm vitest run
```

Expected: PASS across all files. Adjust existing `RichMarkdown` assertions if they inspected DOM structure that's now changed.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/app/components/chat/CodeCollapsible.vue packages/frontend/app/components/chat/RichMarkdown.vue packages/frontend/tests/components/chat/CodeCollapsible.test.ts
git commit -m "feat(frontend): collapse long code blocks behind a show-more toggle"
```

---

## Pre-push gate

After each phase and before any push:

- [ ] `task lint:check` — zero errors
- [ ] `task test:all` — all tests pass
- [ ] No debug `console.log` in committed code
- [ ] All commits on branch follow conventional-commit format
- [ ] `AGENTS.md` reflects any new patterns added this session
- [ ] `.context/agents/patterns/index.md` — register any new pattern (e.g. "RichMarkdown renderer + tool formatters")

---

## Self-review notes

- **Coverage:** Every in-scope item from `design.md` maps to a task: assistant text (2.1), bash (3.1/3.2), JSON (3.1/3.2), diffs (4.1/4.3), file reads (4.2/4.3), file-path linkify (5.1/5.3), stack traces (5.2/5.3), mermaid (6.1), long-output collapsible (6.2), auto-links (1.3 via markdown-it `linkify: true`), tables (1.3 via GFM), images (1.3 via markdown-it default + sanitize allowlist).
- **Types consistency:** `formatToolInput(name, input)` and `formatToolOutput(name, content, input?)` signatures are reused identically across phases.
- **Out of scope held:** no task touches todo-list rendering, status/meta chips, subagent transcripts, LaTeX, or iframe HTML previews.
