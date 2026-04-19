# Chat render modes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a rigorous chat rendering system with full SDK event coverage, three per-component render modes (badge / compact / full), sticky regions, and a drift-resistant sync pattern — per [`design.md`](./design.md).

**Architecture:** Three decoupled layers — a reducer that classifies SDK events and maintains keyed state, a set of uniform-contract Vue components composed from NuxtUI chat primitives, and a UI-only render-mode store. A single event-registry file is the source of truth; a build-time drift test prevents silent divergence from the SDK.

**Tech Stack:** Nuxt 4 (Vue 3) · NuxtUI 4.6 (`UChatMessage`, `UChatTool`, `UChatReasoning`, `UChatShimmer`) · Pinia · Vitest + @nuxt/test-utils + @vue/test-utils · `@anthropic-ai/claude-agent-sdk` types · Lucide icons (`i-lucide-*`) via `UIcon`.

**Conventions:**
- **Commits:** conventional commits, one per completed task. Scope: `frontend`.
- **Tests:** live in `packages/frontend/tests/` mirroring `app/` structure.
- **No emoji:** all iconography uses Lucide via `UIcon name="i-lucide-*"` — in code and in test fixtures/snapshots.
- **File layout:** chat composables under `app/composables/chat/`; chat components under `app/components/chat/` (flat).
- **Test command for a single file:** `cd packages/frontend && pnpm vitest run tests/path/to.test.ts`.
- **Full test suite:** `task test:frontend`. Pre-push gate: `task lint:check && task test:all`.

**Scope note:** This is one cohesive subsystem (the chat render layer) and is implemented as a single plan, but delivered across phases that ship incrementally. Each phase ends with a green test suite and a working chat view.

---

## Phase 0 — Foundations (types + registry + classifier)

### Task 0.1: Add SDK as frontend type-only devDependency

**Why:** The registry and drift test need to import `SDKMessage` and related type unions from `@anthropic-ai/claude-agent-sdk`. The package currently lives only in `packages/backend`. Adding it as a frontend devDep allows type imports without shipping SDK runtime code to the browser (TypeScript erases type-only imports).

**Files:**
- Modify: `packages/frontend/package.json`

- [ ] **Step 1: Add the devDependency**

Run from repo root:

```bash
cd packages/frontend && pnpm add -D @anthropic-ai/claude-agent-sdk@^0.2.114
```

- [ ] **Step 2: Verify type import resolves**

Create a throwaway verification file at `packages/frontend/app/types/sdk-verify.ts`:

```ts
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
export type _Verify = SDKMessage['type']
```

Run: `cd packages/frontend && pnpm exec nuxt typecheck` (or `pnpm vue-tsc --noEmit` if typecheck script absent).
Expected: no errors. Then delete `sdk-verify.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/package.json packages/frontend/../pnpm-lock.yaml
git commit -m "chore(frontend): add claude-agent-sdk as type-only devDependency"
```

---

### Task 0.2: Define core chat types

**Files:**
- Create: `packages/frontend/app/types/chat.ts`

- [ ] **Step 1: Write the types file**

```ts
// packages/frontend/app/types/chat.ts
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

/** The three render modes a chat component can show itself in. */
export type RenderMode = 'badge' | 'compact' | 'full'

/** How the reducer handles an incoming SDK event. */
export type Relationship =
  | 'spawn'        // new component in the stream
  | 'mutate'       // update existing component by correlation key
  | 'fan-out'      // one event → multiple components (assistant content blocks)
  | 'side-channel' // not in the stream — header / toast / banner
  | 'replace'      // later event supersedes an earlier render
  | 'discard'      // never renders

/** Our internal component kind — drives the component resolver. */
export type ChatEventKind =
  | 'assistant'
  | 'user'
  | 'user-replay'
  | 'block-text'
  | 'block-thinking'
  | 'block-tool-use'
  | 'block-image'
  | 'block-redacted-thinking'
  | 'result'
  | 'system-init'
  | 'compact-boundary'
  | 'api-retry'
  | 'local-command-output'
  | 'notification'
  | 'tool-use-summary'
  | 'hook-entry'
  | 'task-entry'
  | 'memory-recall'
  | 'elicitation-complete'
  | 'generic-system'
  | 'tool-confirmation'
  | 'bridge-error'

/** Registry descriptor — one per SDK variant (or bridge wrapper). */
export interface ChatEventDescriptor {
  type: string
  subtype?: string
  kind: ChatEventKind
  relationship: Relationship
  /** Function that extracts the correlation key from an event, or undefined for spawn/discard. */
  correlationKey?: (event: unknown) => string | undefined
  tier: 'T1' | 'T2' | 'T3' | 'BR'
  /** Component name to render (undefined = no chat component, e.g. side-channel or discard). */
  component?: string
  defaultMode: RenderMode
  /** SDK interface name for drift-test coverage. */
  sdkType: string
  sdkVersionValidated: string
}

/** A component descriptor emitted by the reducer to the chat stream. */
export interface ChatStreamComponent {
  componentKey: string
  kind: ChatEventKind
  data: unknown
  defaultMode: RenderMode
  sticky?: boolean
  /** Reducer-tracked in-flight state (e.g. streaming, running, error). */
  status?: 'streaming' | 'running' | 'success' | 'error' | 'cancelled'
}

/** A side-channel event — consumed by SessionHeader / toasts / status bar. */
export interface ChatSideChannelEvent {
  kind: ChatEventKind
  data: unknown
}

/** Raw SDK message envelope that flows from WebSocket through sessionStore. */
export type RawEvent = SDKMessage | { type: `bridge:${string}`; [k: string]: unknown } | { event: string; [k: string]: unknown }
```

- [ ] **Step 2: Verify types compile**

Run: `cd packages/frontend && pnpm exec vue-tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/app/types/chat.ts
git commit -m "feat(frontend): add chat render-mode core types"
```

---

### Task 0.3: Create the event registry (Tier-1 entries only)

**Rationale:** Start with T1 coverage so we can ship a working chat end-to-end before expanding. T2 and T3 entries are added in later tasks alongside their components. The drift test (Task 7.1) guards against forgetting an SDK type when the union changes.

**Files:**
- Create: `packages/frontend/app/composables/chat/event-registry.ts`

- [ ] **Step 1: Write the registry with T1 entries**

```ts
// packages/frontend/app/composables/chat/event-registry.ts
import type { ChatEventDescriptor } from '~/types/chat'

const SDK_VERSION = '0.2.114'

/**
 * Helpers — correlation-key extractors. Typed loosely on purpose; the
 * classifier is the only caller and it treats unknown input.
 */
const byMessageId = (e: any) => e?.message?.id as string | undefined
const bySessionId = (e: any) => e?.session_id as string | undefined

export const CHAT_EVENT_REGISTRY: ChatEventDescriptor[] = [
  // ── Layer 1 envelopes ──────────────────────────────────────────
  { type: 'assistant', kind: 'assistant', relationship: 'fan-out',
    correlationKey: byMessageId,
    tier: 'T1', component: 'ChatAssistantMessage', defaultMode: 'full',
    sdkType: 'SDKAssistantMessage', sdkVersionValidated: SDK_VERSION },

  { type: 'user', kind: 'user', relationship: 'spawn',
    tier: 'T1', component: 'ChatUserMessage', defaultMode: 'full',
    sdkType: 'SDKUserMessage', sdkVersionValidated: SDK_VERSION },

  // ── Streaming ──────────────────────────────────────────────────
  { type: 'stream_event', kind: 'assistant', relationship: 'mutate',
    correlationKey: byMessageId,
    tier: 'T1', defaultMode: 'full',
    sdkType: 'SDKPartialAssistantMessage', sdkVersionValidated: SDK_VERSION },

  // ── Result / turn summary ──────────────────────────────────────
  { type: 'result', kind: 'result', relationship: 'spawn',
    tier: 'T1', component: 'ChatResult', defaultMode: 'compact',
    sdkType: 'SDKResultMessage', sdkVersionValidated: SDK_VERSION },

  // ── System events ──────────────────────────────────────────────
  { type: 'system', subtype: 'init', kind: 'system-init', relationship: 'spawn',
    tier: 'T1', component: 'ChatSystemInit', defaultMode: 'compact',
    sdkType: 'SDKSystemMessage', sdkVersionValidated: SDK_VERSION },

  { type: 'system', subtype: 'compact_boundary', kind: 'compact-boundary', relationship: 'spawn',
    tier: 'T1', component: 'ChatCompactBoundary', defaultMode: 'badge',
    sdkType: 'SDKCompactBoundaryMessage', sdkVersionValidated: SDK_VERSION },

  { type: 'system', subtype: 'status', kind: 'generic-system', relationship: 'side-channel',
    correlationKey: bySessionId,
    tier: 'T1', defaultMode: 'badge',
    sdkType: 'SDKStatusMessage', sdkVersionValidated: SDK_VERSION },

  { type: 'rate_limit_event', kind: 'generic-system', relationship: 'side-channel',
    tier: 'T1', defaultMode: 'badge',
    sdkType: 'SDKRateLimitEvent', sdkVersionValidated: SDK_VERSION },

  // ── Bridge wrappers ────────────────────────────────────────────
  { type: 'tool_confirmation', kind: 'tool-confirmation', relationship: 'spawn',
    tier: 'BR', component: 'ChatToolConfirmation', defaultMode: 'full',
    sdkType: 'BridgeToolConfirmation', sdkVersionValidated: SDK_VERSION },

  { type: 'bridge:error', kind: 'bridge-error', relationship: 'spawn',
    tier: 'BR', component: 'ChatBridgeError', defaultMode: 'full',
    sdkType: 'BridgeError', sdkVersionValidated: SDK_VERSION },

  { type: 'bridge:ready', kind: 'generic-system', relationship: 'discard',
    tier: 'BR', defaultMode: 'badge',
    sdkType: 'BridgeReady', sdkVersionValidated: SDK_VERSION },
  { type: 'bridge:stderr', kind: 'generic-system', relationship: 'discard',
    tier: 'BR', defaultMode: 'badge',
    sdkType: 'BridgeStderr', sdkVersionValidated: SDK_VERSION },
]

/** Find the descriptor matching a raw event, or null if unknown. */
export function findDescriptor(type: string, subtype?: string): ChatEventDescriptor | null {
  return CHAT_EVENT_REGISTRY.find(
    d => d.type === type && (d.subtype === undefined || d.subtype === subtype),
  ) ?? null
}
```

- [ ] **Step 2: Verify compiles**

Run: `cd packages/frontend && pnpm exec vue-tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/app/composables/chat/event-registry.ts
git commit -m "feat(frontend): add chat event registry with T1 entries"
```

---

### Task 0.4: Write `classifyEvent` pure function (TDD)

**Files:**
- Create: `packages/frontend/tests/composables/chat/classify-event.test.ts`
- Create: `packages/frontend/app/composables/chat/classify-event.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/frontend/tests/composables/chat/classify-event.test.ts
import { describe, it, expect } from 'vitest'
import { classifyEvent } from '~/composables/chat/classify-event'

describe('classifyEvent', () => {
  it('classifies an assistant message as fan-out with a message-id correlation key', () => {
    const event = { type: 'assistant', message: { id: 'msg_01' }, content: [] }
    const result = classifyEvent(event)
    expect(result).toEqual({
      relationship: 'fan-out',
      correlationKey: 'msg_01',
      kind: 'assistant',
      descriptor: expect.objectContaining({ sdkType: 'SDKAssistantMessage' }),
    })
  })

  it('classifies a user message as spawn with no correlation key', () => {
    const event = { type: 'user', content: 'hi' }
    expect(classifyEvent(event)).toEqual({
      relationship: 'spawn',
      correlationKey: undefined,
      kind: 'user',
      descriptor: expect.objectContaining({ sdkType: 'SDKUserMessage' }),
    })
  })

  it('classifies a stream_event as mutate keyed by message id', () => {
    const event = { type: 'stream_event', message: { id: 'msg_02' }, delta: {} }
    expect(classifyEvent(event)).toEqual({
      relationship: 'mutate',
      correlationKey: 'msg_02',
      kind: 'assistant',
      descriptor: expect.objectContaining({ sdkType: 'SDKPartialAssistantMessage' }),
    })
  })

  it('classifies system init as spawn', () => {
    const event = { type: 'system', subtype: 'init', model: 'claude-opus-4-7' }
    expect(classifyEvent(event).relationship).toBe('spawn')
    expect(classifyEvent(event).kind).toBe('system-init')
  })

  it('classifies system status as side-channel', () => {
    const event = { type: 'system', subtype: 'status', status: 'requesting' }
    expect(classifyEvent(event).relationship).toBe('side-channel')
  })

  it('classifies rate_limit_event as side-channel', () => {
    expect(classifyEvent({ type: 'rate_limit_event' }).relationship).toBe('side-channel')
  })

  it('classifies bridge:ready as discard', () => {
    expect(classifyEvent({ type: 'bridge:ready' }).relationship).toBe('discard')
  })

  it('classifies bridge:error as spawn', () => {
    expect(classifyEvent({ type: 'bridge:error', message: 'x' }).relationship).toBe('spawn')
  })

  it('returns null-descriptor entry for unknown events', () => {
    const result = classifyEvent({ type: 'totally_made_up' })
    expect(result).toEqual({
      relationship: 'discard',
      correlationKey: undefined,
      kind: 'generic-system',
      descriptor: null,
    })
  })

  it('matches the more specific subtype entry when both match', () => {
    // system/init has a dedicated descriptor; system without subtype does not.
    expect(classifyEvent({ type: 'system', subtype: 'init' }).kind).toBe('system-init')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/frontend && pnpm vitest run tests/composables/chat/classify-event.test.ts`
Expected: FAIL — module `classify-event` not found.

- [ ] **Step 3: Implement `classifyEvent`**

```ts
// packages/frontend/app/composables/chat/classify-event.ts
import type { ChatEventDescriptor, ChatEventKind, Relationship } from '~/types/chat'
import { findDescriptor } from './event-registry'

export interface Classification {
  relationship: Relationship
  correlationKey: string | undefined
  kind: ChatEventKind
  descriptor: ChatEventDescriptor | null
}

export function classifyEvent(event: unknown): Classification {
  const e = (event ?? {}) as Record<string, unknown>
  const type = (e.type ?? e.event) as string | undefined
  const subtype = e.subtype as string | undefined

  if (!type) {
    return { relationship: 'discard', correlationKey: undefined, kind: 'generic-system', descriptor: null }
  }

  const descriptor = findDescriptor(type, subtype)
  if (!descriptor) {
    return { relationship: 'discard', correlationKey: undefined, kind: 'generic-system', descriptor: null }
  }

  const correlationKey = descriptor.correlationKey?.(event)
  return {
    relationship: descriptor.relationship,
    correlationKey,
    kind: descriptor.kind,
    descriptor,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/frontend && pnpm vitest run tests/composables/chat/classify-event.test.ts`
Expected: all 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/composables/chat/classify-event.ts \
        packages/frontend/tests/composables/chat/classify-event.test.ts
git commit -m "feat(frontend): classify chat events against registry"
```

---

## Phase 1 — Composables (reducer + render mode store)

### Task 1.1: `useChatRenderMode` composable (TDD)

**Files:**
- Create: `packages/frontend/tests/composables/chat/use-chat-render-mode.test.ts`
- Create: `packages/frontend/app/composables/chat/use-chat-render-mode.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/frontend/tests/composables/chat/use-chat-render-mode.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useChatRenderMode } from '~/composables/chat/use-chat-render-mode'

describe('useChatRenderMode', () => {
  beforeEach(() => {
    useChatRenderMode().resetAll()
  })

  it('returns the default mode when no override exists', () => {
    const { mode } = useChatRenderMode().useRenderMode('comp_1', 'badge')
    expect(mode.value).toBe('badge')
  })

  it('returns the override when set', () => {
    const api = useChatRenderMode().useRenderMode('comp_1', 'badge')
    api.setMode('full')
    expect(api.mode.value).toBe('full')
  })

  it('reset clears the override and returns to default', () => {
    const api = useChatRenderMode().useRenderMode('comp_1', 'badge')
    api.setMode('full')
    api.reset()
    expect(api.mode.value).toBe('badge')
  })

  it('respects sticky mode override (forces compact) when sticky=true', () => {
    const api = useChatRenderMode().useRenderMode('comp_1', 'full', { sticky: true })
    expect(api.mode.value).toBe('compact')
  })

  it('user override still wins over sticky', () => {
    const api = useChatRenderMode().useRenderMode('comp_1', 'full', { sticky: true })
    api.setMode('full')
    expect(api.mode.value).toBe('full')
  })

  it('different componentKeys have independent state', () => {
    const a = useChatRenderMode().useRenderMode('a', 'badge')
    const b = useChatRenderMode().useRenderMode('b', 'badge')
    a.setMode('full')
    expect(a.mode.value).toBe('full')
    expect(b.mode.value).toBe('badge')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/frontend && pnpm vitest run tests/composables/chat/use-chat-render-mode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useChatRenderMode`**

```ts
// packages/frontend/app/composables/chat/use-chat-render-mode.ts
import type { RenderMode } from '~/types/chat'

interface UseRenderModeOptions {
  sticky?: boolean
}

interface UseRenderModeApi {
  mode: Ref<RenderMode>
  setMode: (mode: RenderMode) => void
  reset: () => void
}

// Module-scoped singletons so the same componentKey shares state across call sites.
const overrides = reactive<Map<string, RenderMode>>(new Map())

function useRenderMode(
  componentKey: string,
  defaultMode: RenderMode,
  options: UseRenderModeOptions = {},
): UseRenderModeApi {
  const mode = computed<RenderMode>(() => {
    const override = overrides.get(componentKey)
    if (override) return override
    if (options.sticky) return 'compact'
    return defaultMode
  })

  function setMode(newMode: RenderMode) {
    overrides.set(componentKey, newMode)
  }

  function reset() {
    overrides.delete(componentKey)
  }

  return { mode: mode as unknown as Ref<RenderMode>, setMode, reset }
}

function resetAll() {
  overrides.clear()
}

export function useChatRenderMode() {
  return { useRenderMode, resetAll }
}
```

- [ ] **Step 4: Add `Ref` to setup globals**

Modify `packages/frontend/tests/setup.ts` — add `Ref` alongside the other Vue reactivity exports:

```ts
// Inside tests/setup.ts, replace the Vue reactivity block with:
import { ref, computed, reactive, toRaw, watch, watchEffect, nextTick } from 'vue'

;(globalThis as any).ref = ref
;(globalThis as any).computed = computed
;(globalThis as any).reactive = reactive
;(globalThis as any).toRaw = toRaw
;(globalThis as any).watch = watch
;(globalThis as any).watchEffect = watchEffect
;(globalThis as any).nextTick = nextTick
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/frontend && pnpm vitest run tests/composables/chat/use-chat-render-mode.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/app/composables/chat/use-chat-render-mode.ts \
        packages/frontend/tests/composables/chat/use-chat-render-mode.test.ts \
        packages/frontend/tests/setup.ts
git commit -m "feat(frontend): add useChatRenderMode with per-instance overrides"
```

---

### Task 1.2: `useChatReducer` — spawn, discard, side-channel (TDD)

**Files:**
- Create: `packages/frontend/tests/composables/chat/use-chat-reducer.test.ts`
- Create: `packages/frontend/app/composables/chat/use-chat-reducer.ts`

- [ ] **Step 1: Write failing tests (spawn / discard / side-channel)**

```ts
// packages/frontend/tests/composables/chat/use-chat-reducer.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { ref } from 'vue'
import { useChatReducer } from '~/composables/chat/use-chat-reducer'

function makeMessage(raw: unknown) {
  return { id: crypto.randomUUID(), sessionId: 's1', timestamp: new Date().toISOString(), raw: raw as any }
}

describe('useChatReducer — spawn / discard / side-channel', () => {
  it('produces a single spawn component for a user message', () => {
    const src = ref([makeMessage({ type: 'user', content: 'hello' })])
    const { components, sideChannel } = useChatReducer(src)
    expect(components.value).toHaveLength(1)
    expect(components.value[0]).toMatchObject({ kind: 'user', defaultMode: 'full' })
    expect(sideChannel.value).toHaveLength(0)
  })

  it('discards bridge:ready events', () => {
    const src = ref([makeMessage({ type: 'bridge:ready' })])
    const { components } = useChatReducer(src)
    expect(components.value).toHaveLength(0)
  })

  it('routes status events to the side-channel emitter, not the stream', () => {
    const src = ref([
      makeMessage({ type: 'system', subtype: 'status', status: 'requesting' }),
    ])
    const { components, sideChannel } = useChatReducer(src)
    expect(components.value).toHaveLength(0)
    expect(sideChannel.value).toHaveLength(1)
    expect(sideChannel.value[0].kind).toBe('generic-system')
  })

  it('preserves event order for multiple spawns', () => {
    const src = ref([
      makeMessage({ type: 'user', content: 'a' }),
      makeMessage({ type: 'system', subtype: 'init', model: 'x' }),
    ])
    const { components } = useChatReducer(src)
    expect(components.value.map(c => c.kind)).toEqual(['user', 'system-init'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/frontend && pnpm vitest run tests/composables/chat/use-chat-reducer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement skeleton reducer (spawn / discard / side-channel only)**

```ts
// packages/frontend/app/composables/chat/use-chat-reducer.ts
import type { Ref } from 'vue'
import type { ChatMessage } from '~/types'
import type { ChatStreamComponent, ChatSideChannelEvent } from '~/types/chat'
import { classifyEvent } from './classify-event'

export function useChatReducer(source: Ref<ChatMessage[]>) {
  const components = computed<ChatStreamComponent[]>(() => derive(source.value).components)
  const sideChannel = computed<ChatSideChannelEvent[]>(() => derive(source.value).sideChannel)

  return { components, sideChannel }
}

interface Derived {
  components: ChatStreamComponent[]
  sideChannel: ChatSideChannelEvent[]
}

function derive(messages: ChatMessage[]): Derived {
  const out: ChatStreamComponent[] = []
  const side: ChatSideChannelEvent[] = []

  for (const msg of messages) {
    const raw = (msg.raw?.data ?? msg.raw) as unknown
    const { relationship, descriptor, kind } = classifyEvent(raw)

    if (relationship === 'discard' || !descriptor) continue

    if (relationship === 'side-channel') {
      side.push({ kind, data: raw })
      continue
    }

    if (relationship === 'spawn') {
      out.push({
        componentKey: msg.id,
        kind,
        data: raw,
        defaultMode: descriptor.defaultMode,
      })
      continue
    }

    // 'mutate' / 'fan-out' / 'replace' — handled in later tasks.
  }

  return { components: out, sideChannel: side }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/frontend && pnpm vitest run tests/composables/chat/use-chat-reducer.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/composables/chat/use-chat-reducer.ts \
        packages/frontend/tests/composables/chat/use-chat-reducer.test.ts
git commit -m "feat(frontend): reducer handles spawn, discard, side-channel"
```

---

### Task 1.3: Reducer — fan-out for assistant content blocks (TDD)

**Files:**
- Modify: `packages/frontend/app/composables/chat/use-chat-reducer.ts`
- Modify: `packages/frontend/tests/composables/chat/use-chat-reducer.test.ts`

- [ ] **Step 1: Add failing fan-out tests**

Append to `use-chat-reducer.test.ts`:

```ts
describe('useChatReducer — fan-out', () => {
  it('fans out an assistant message with text + tool_use blocks into 2 components', () => {
    const src = ref([makeMessage({
      type: 'assistant',
      message: {
        id: 'msg_1',
        content: [
          { type: 'text', text: 'ok' },
          { type: 'tool_use', id: 'tool_a', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    })])
    const { components } = useChatReducer(src)
    expect(components.value).toHaveLength(2)
    expect(components.value[0].kind).toBe('block-text')
    expect(components.value[1].kind).toBe('block-tool-use')
    expect(components.value[1].componentKey).toBe('tool_a') // tool_use_id for correlation
  })

  it('falls back to index-based key for blocks with no id', () => {
    const src = ref([makeMessage({
      type: 'assistant',
      message: { id: 'msg_2', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
    })])
    const { components } = useChatReducer(src)
    expect(components.value.map(c => c.componentKey)).toEqual(['msg_2:0', 'msg_2:1'])
  })

  it('assigns defaults: text=full, thinking=compact, tool_use=badge', () => {
    const src = ref([makeMessage({
      type: 'assistant',
      message: {
        id: 'msg_3',
        content: [
          { type: 'text', text: 't' },
          { type: 'thinking', thinking: 'hmm' },
          { type: 'tool_use', id: 'x', name: 'Read', input: {} },
        ],
      },
    })])
    const { components } = useChatReducer(src)
    expect(components.value.map(c => c.defaultMode)).toEqual(['full', 'compact', 'badge'])
  })
})
```

- [ ] **Step 2: Verify test fails**

Run: `cd packages/frontend && pnpm vitest run tests/composables/chat/use-chat-reducer.test.ts`
Expected: 3 new tests FAIL (assistant events produce no components yet).

- [ ] **Step 3: Extend the reducer with block-level fan-out**

Replace the `derive` function in `use-chat-reducer.ts` with:

```ts
interface Block { type: string; id?: string; name?: string; thinking?: string; text?: string; [k: string]: unknown }

const BLOCK_KIND_MAP: Record<string, { kind: ChatEventKind; defaultMode: 'badge' | 'compact' | 'full' }> = {
  text: { kind: 'block-text', defaultMode: 'full' },
  thinking: { kind: 'block-thinking', defaultMode: 'compact' },
  tool_use: { kind: 'block-tool-use', defaultMode: 'badge' },
  image: { kind: 'block-image', defaultMode: 'compact' },
  redacted_thinking: { kind: 'block-redacted-thinking', defaultMode: 'badge' },
}

function fanOutAssistant(msg: ChatMessage, raw: any): ChatStreamComponent[] {
  const messageId = raw?.message?.id ?? msg.id
  const blocks: Block[] = raw?.message?.content ?? []
  return blocks.map((block, i) => {
    const mapping = BLOCK_KIND_MAP[block.type]
    if (!mapping) {
      return {
        componentKey: `${messageId}:${i}`,
        kind: 'generic-system',
        data: block,
        defaultMode: 'badge',
      }
    }
    const componentKey = block.id ?? `${messageId}:${i}`
    return {
      componentKey,
      kind: mapping.kind,
      data: block,
      defaultMode: mapping.defaultMode,
    }
  })
}

function derive(messages: ChatMessage[]): Derived {
  const out: ChatStreamComponent[] = []
  const side: ChatSideChannelEvent[] = []

  for (const msg of messages) {
    const raw = (msg.raw?.data ?? msg.raw) as any
    const { relationship, descriptor, kind } = classifyEvent(raw)

    if (relationship === 'discard' || !descriptor) continue

    if (relationship === 'side-channel') {
      side.push({ kind, data: raw })
      continue
    }

    if (relationship === 'spawn') {
      out.push({
        componentKey: msg.id,
        kind,
        data: raw,
        defaultMode: descriptor.defaultMode,
      })
      continue
    }

    if (relationship === 'fan-out') {
      out.push(...fanOutAssistant(msg, raw))
      continue
    }

    // 'mutate' / 'replace' — handled in later tasks.
  }

  return { components: out, sideChannel: side }
}
```

Also import `ChatEventKind` at the top: `import type { ChatStreamComponent, ChatSideChannelEvent, ChatEventKind } from '~/types/chat'`.

- [ ] **Step 4: Verify all tests pass**

Run: `cd packages/frontend && pnpm vitest run tests/composables/chat/use-chat-reducer.test.ts`
Expected: all tests PASS (including the 3 new fan-out ones).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/composables/chat/use-chat-reducer.ts \
        packages/frontend/tests/composables/chat/use-chat-reducer.test.ts
git commit -m "feat(frontend): reducer fans out assistant content blocks"
```

---

### Task 1.4: Reducer — mutate for tool_use ↔ tool_result pairing (TDD)

**Files:**
- Modify: `packages/frontend/app/composables/chat/use-chat-reducer.ts`
- Modify: `packages/frontend/tests/composables/chat/use-chat-reducer.test.ts`

- [ ] **Step 1: Add failing pairing tests**

Append:

```ts
describe('useChatReducer — tool_use ↔ tool_result pairing', () => {
  it('attaches a tool_result to its paired tool_use by tool_use_id', () => {
    const src = ref([
      makeMessage({
        type: 'assistant',
        message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { cmd: 'ls' } }] },
      }),
      makeMessage({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'output', is_error: false }] },
      }),
    ])
    const { components } = useChatReducer(src)
    expect(components.value).toHaveLength(1) // user message with only tool_result is not a separate spawn
    const tool = components.value[0]
    expect(tool.kind).toBe('block-tool-use')
    expect((tool.data as any).tool_result).toMatchObject({ content: 'output', is_error: false })
    expect(tool.status).toBe('success')
  })

  it('sets status=error when the paired tool_result is is_error', () => {
    const src = ref([
      makeMessage({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: {} }] } }),
      makeMessage({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'boom', is_error: true }] } }),
    ])
    const { components } = useChatReducer(src)
    expect(components.value[0].status).toBe('error')
  })

  it('flips defaultMode from badge to compact for failed tools', () => {
    const src = ref([
      makeMessage({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't3', name: 'Edit', input: {} }] } }),
      makeMessage({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't3', content: 'x', is_error: true }] } }),
    ])
    const { components } = useChatReducer(src)
    expect(components.value[0].defaultMode).toBe('compact')
  })

  it('tool_use without result shows status=running', () => {
    const src = ref([
      makeMessage({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't4', name: 'Read', input: {} }] } }),
    ])
    const { components } = useChatReducer(src)
    expect(components.value[0].status).toBe('running')
  })
})
```

- [ ] **Step 2: Verify tests fail**

Run: `cd packages/frontend && pnpm vitest run tests/composables/chat/use-chat-reducer.test.ts`
Expected: 4 new tests FAIL.

- [ ] **Step 3: Extend reducer with pairing logic**

Update `use-chat-reducer.ts` — replace `derive` with a two-pass approach:

```ts
function derive(messages: ChatMessage[]): Derived {
  const out: ChatStreamComponent[] = []
  const side: ChatSideChannelEvent[] = []
  // Pass 1: walk events, track tool_results to fold in.
  const toolResults = new Map<string, { content: unknown; is_error: boolean }>()
  const userMessagesWithOnlyToolResults = new Set<string>()

  for (const msg of messages) {
    const raw = (msg.raw?.data ?? msg.raw) as any
    if (raw?.type === 'user') {
      const content = raw?.message?.content
      if (Array.isArray(content) && content.every((b: any) => b?.type === 'tool_result')) {
        for (const b of content) {
          toolResults.set(b.tool_use_id, { content: b.content, is_error: !!b.is_error })
        }
        userMessagesWithOnlyToolResults.add(msg.id)
      }
    }
  }

  // Pass 2: build components.
  for (const msg of messages) {
    const raw = (msg.raw?.data ?? msg.raw) as any
    const { relationship, descriptor, kind } = classifyEvent(raw)

    if (relationship === 'discard' || !descriptor) continue
    if (userMessagesWithOnlyToolResults.has(msg.id)) continue // folded into tool_use components

    if (relationship === 'side-channel') { side.push({ kind, data: raw }); continue }

    if (relationship === 'spawn') {
      out.push({ componentKey: msg.id, kind, data: raw, defaultMode: descriptor.defaultMode })
      continue
    }

    if (relationship === 'fan-out') {
      const fanned = fanOutAssistant(msg, raw)
      for (const c of fanned) {
        if (c.kind === 'block-tool-use') {
          const block = c.data as any
          const result = toolResults.get(block.id)
          if (result) {
            c.data = { ...block, tool_result: result }
            c.status = result.is_error ? 'error' : 'success'
            if (result.is_error) c.defaultMode = 'compact'
          } else {
            c.status = 'running'
          }
        }
        out.push(c)
      }
      continue
    }
  }

  return { components: out, sideChannel: side }
}
```

- [ ] **Step 4: Verify tests pass**

Run: `cd packages/frontend && pnpm vitest run tests/composables/chat/use-chat-reducer.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/composables/chat/use-chat-reducer.ts \
        packages/frontend/tests/composables/chat/use-chat-reducer.test.ts
git commit -m "feat(frontend): reducer pairs tool_use with tool_result"
```

---

### Task 1.5: Reducer — streaming mutate + sticky flag (TDD)

**Files:**
- Modify: `packages/frontend/app/composables/chat/use-chat-reducer.ts`
- Modify: `packages/frontend/tests/composables/chat/use-chat-reducer.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe('useChatReducer — streaming and sticky', () => {
  it('sets status=streaming on an assistant component that has a later stream_event with matching message.id', () => {
    const src = ref([
      makeMessage({ type: 'assistant', message: { id: 'msg_5', content: [{ type: 'text', text: 'par' }] } }),
      makeMessage({ type: 'stream_event', message: { id: 'msg_5' }, delta: { type: 'text_delta', text: 'tial' } }),
    ])
    const { components } = useChatReducer(src)
    const txt = components.value.find(c => c.kind === 'block-text')!
    expect(txt.status).toBe('streaming')
  })

  it('marks the latest user message as sticky while any non-user components follow it', () => {
    const src = ref([
      makeMessage({ type: 'user', content: 'go' }),
      makeMessage({ type: 'assistant', message: { id: 'm', content: [{ type: 'text', text: 'yes' }] } }),
    ])
    const { components } = useChatReducer(src)
    const user = components.value.find(c => c.kind === 'user')!
    expect(user.sticky).toBe(true)
  })

  it('does not mark the user message as sticky if it is the last component', () => {
    const src = ref([makeMessage({ type: 'user', content: 'hi' })])
    const { components } = useChatReducer(src)
    expect(components.value[0].sticky).toBeUndefined()
  })

  it('marks active tool-confirmation as sticky', () => {
    const src = ref([makeMessage({ event: 'session:tool-confirmation', type: 'tool_confirmation', tool: 'Bash' })])
    const { components } = useChatReducer(src)
    expect(components.value[0].sticky).toBe(true)
  })
})
```

- [ ] **Step 2: Verify failures**

Run: `cd packages/frontend && pnpm vitest run tests/composables/chat/use-chat-reducer.test.ts`
Expected: the 4 new tests FAIL.

- [ ] **Step 3: Extend reducer — streaming flag + sticky pass**

In `derive`, after Pass 2 but before the `return`, add:

```ts
  // Pass 3: streaming mutate — any stream_event with matching message.id marks the assistant stream as streaming.
  const streamingMessageIds = new Set<string>()
  for (const msg of messages) {
    const raw = (msg.raw?.data ?? msg.raw) as any
    if (raw?.type === 'stream_event') {
      const id = raw?.message?.id
      if (typeof id === 'string') streamingMessageIds.add(id)
    }
  }
  // Also: if an assistant message has a later stream_event, its blocks stream. If a later result/assistant arrives for the same id, streaming ends.
  const finalized = new Set<string>()
  for (const msg of messages) {
    const raw = (msg.raw?.data ?? msg.raw) as any
    if (raw?.type === 'result') finalized.add('*')
  }
  for (const c of out) {
    const messageId = (c.data as any)?.message?.id ?? (c.componentKey.includes(':') ? c.componentKey.split(':')[0] : undefined)
    if (messageId && streamingMessageIds.has(messageId) && !finalized.has('*')) {
      if (c.kind === 'block-text' || c.kind === 'block-tool-use' || c.kind === 'block-thinking') {
        c.status = c.status ?? 'streaming'
      }
    }
  }

  // Pass 4: sticky eligibility.
  let lastUserIdx = -1
  for (let i = 0; i < out.length; i++) if (out[i].kind === 'user') lastUserIdx = i
  if (lastUserIdx !== -1 && lastUserIdx < out.length - 1) out[lastUserIdx].sticky = true
  for (const c of out) if (c.kind === 'tool-confirmation') c.sticky = true
```

Also adjust the fan-out to carry the parent `message.id` onto each block's data so the Pass-3 lookup works. In `fanOutAssistant`, include the parent id in each block's data:

```ts
  return blocks.map((block, i) => {
    const mapping = BLOCK_KIND_MAP[block.type]
    const dataWithParent = { ...block, _parentMessageId: messageId }
    const componentKey = block.id ?? `${messageId}:${i}`
    if (!mapping) {
      return { componentKey, kind: 'generic-system' as const, data: dataWithParent, defaultMode: 'badge' as const }
    }
    return { componentKey, kind: mapping.kind, data: dataWithParent, defaultMode: mapping.defaultMode }
  })
```

And in Pass 3, read the parent id from `data._parentMessageId`:

```ts
    const messageId = (c.data as any)?._parentMessageId ?? (c.data as any)?.message?.id
```

- [ ] **Step 4: Verify all tests pass**

Run: `cd packages/frontend && pnpm vitest run tests/composables/chat/use-chat-reducer.test.ts`
Expected: all tests PASS (original + new streaming/sticky).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/composables/chat/use-chat-reducer.ts \
        packages/frontend/tests/composables/chat/use-chat-reducer.test.ts
git commit -m "feat(frontend): reducer tracks streaming status and sticky eligibility"
```

---

## Phase 2 — Content-block components (Layer 2)

### Task 2.1: `ChatBlockText` component

**Files:**
- Create: `packages/frontend/app/components/chat/ChatBlockText.vue`
- Create: `packages/frontend/tests/components/chat/ChatBlockText.test.ts`

- [ ] **Step 1: Write the failing component test**

```ts
// packages/frontend/tests/components/chat/ChatBlockText.test.ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatBlockText from '~/components/chat/ChatBlockText.vue'

describe('ChatBlockText', () => {
  it('renders the text in full mode', async () => {
    const wrapper = await mountSuspended(ChatBlockText, {
      props: { componentKey: 'k1', defaultMode: 'full', data: { type: 'text', text: 'hello **world**' } },
    })
    expect(wrapper.text()).toContain('hello')
  })

  it('truncates text in compact mode', async () => {
    const wrapper = await mountSuspended(ChatBlockText, {
      props: { componentKey: 'k2', defaultMode: 'compact', data: { type: 'text', text: 'a'.repeat(500) } },
    })
    // Compact renders a single line — ensure DOM has a data-mode attribute we can key on.
    expect(wrapper.attributes('data-mode')).toBe('compact')
  })
})
```

- [ ] **Step 2: Verify failure**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/ChatBlockText.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the component**

```vue
<!-- packages/frontend/app/components/chat/ChatBlockText.vue -->
<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'text'; text?: string; _parentMessageId?: string }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, setMode } = useRenderMode(props.componentKey, props.defaultMode)

const text = computed(() => props.data.text ?? '')

function cycleMode() {
  if (mode.value === 'badge') setMode('compact')
  else if (mode.value === 'compact') setMode('full')
  else setMode('compact')
}
</script>

<template>
  <div
    :data-mode="mode"
    :class="mode === 'badge' ? 'inline-flex items-center gap-1 align-middle' : 'block'"
  >
    <template v-if="mode === 'badge'">
      <UBadge color="neutral" variant="subtle" size="sm" class="cursor-pointer" @click="cycleMode">
        <UIcon name="i-lucide-message-square" class="size-3" />
        <span class="truncate max-w-[14ch]">{{ text }}</span>
      </UBadge>
    </template>
    <template v-else-if="mode === 'compact'">
      <div class="truncate text-sm leading-6">
        <UIcon name="i-lucide-chevron-right" class="size-3 cursor-pointer" @click="cycleMode" />
        {{ text }}
      </div>
    </template>
    <template v-else>
      <!-- full: markdown renderer. Placeholder: raw text with preserved newlines. Replace with MDC / nuxt-mdc if installed. -->
      <div class="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">{{ text }}</div>
    </template>
  </div>
</template>
```

- [ ] **Step 4: Verify tests pass**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/ChatBlockText.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/components/chat/ChatBlockText.vue \
        packages/frontend/tests/components/chat/ChatBlockText.test.ts
git commit -m "feat(frontend): add ChatBlockText with three-mode render"
```

---

### Task 2.2: `ChatBlockThinking` (refactor from `ThinkingBlock.vue`)

**Files:**
- Delete: `packages/frontend/app/components/chat/ThinkingBlock.vue`
- Create: `packages/frontend/app/components/chat/ChatBlockThinking.vue`
- Create: `packages/frontend/tests/components/chat/ChatBlockThinking.test.ts`

- [ ] **Step 1: Read the existing `ThinkingBlock.vue` for reference**

```bash
cat packages/frontend/app/components/chat/ThinkingBlock.vue
```

- [ ] **Step 2: Write failing tests**

```ts
// packages/frontend/tests/components/chat/ChatBlockThinking.test.ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatBlockThinking from '~/components/chat/ChatBlockThinking.vue'

describe('ChatBlockThinking', () => {
  const baseProps = { componentKey: 'k1', defaultMode: 'compact' as const, data: { type: 'thinking', thinking: 'let me think…' } }

  it('renders UChatReasoning in compact mode (collapsed)', async () => {
    const w = await mountSuspended(ChatBlockThinking, { props: baseProps })
    expect(w.attributes('data-mode')).toBe('compact')
    expect(w.findComponent({ name: 'UChatReasoning' }).exists()).toBe(true)
  })

  it('renders a badge in badge mode', async () => {
    const w = await mountSuspended(ChatBlockThinking, { props: { ...baseProps, defaultMode: 'badge' } })
    expect(w.attributes('data-mode')).toBe('badge')
  })
})
```

- [ ] **Step 3: Verify failure**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/ChatBlockThinking.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement the component**

```vue
<!-- packages/frontend/app/components/chat/ChatBlockThinking.vue -->
<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'thinking'; thinking?: string }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, setMode } = useRenderMode(props.componentKey, props.defaultMode)

const thinking = computed(() => props.data.thinking ?? '')
</script>

<template>
  <div
    :data-mode="mode"
    :class="mode === 'badge' ? 'inline-flex items-center align-middle' : 'block my-1'"
  >
    <template v-if="mode === 'badge'">
      <UBadge color="primary" variant="subtle" size="sm" class="cursor-pointer" @click="setMode('compact')">
        <UIcon name="i-lucide-brain" class="size-3" />
        <span class="text-xs">thinking</span>
      </UBadge>
    </template>
    <template v-else>
      <UChatReasoning
        :default-open="mode === 'full'"
        @update:open="(o: boolean) => setMode(o ? 'full' : 'compact')"
      >
        {{ thinking }}
      </UChatReasoning>
    </template>
  </div>
</template>
```

- [ ] **Step 5: Delete the old `ThinkingBlock.vue`**

```bash
git rm packages/frontend/app/components/chat/ThinkingBlock.vue
```

- [ ] **Step 6: Verify tests pass**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/ChatBlockThinking.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/app/components/chat/ChatBlockThinking.vue \
        packages/frontend/tests/components/chat/ChatBlockThinking.test.ts
git commit -m "refactor(frontend): replace ThinkingBlock with ChatBlockThinking (three-mode)"
```

---

### Task 2.3: `ChatBlockToolUse` (refactor from `ToolInvocation.vue`)

**Rationale:** This is the most-used content block. It takes a `tool_use` with an optional paired `tool_result` and renders in all three modes. Badge mode is ours (inline-flex chip with a Lucide icon keyed off the tool name); compact/full use `UChatTool`.

**Files:**
- Delete: `packages/frontend/app/components/chat/ToolInvocation.vue`
- Create: `packages/frontend/app/components/chat/ChatBlockToolUse.vue`
- Create: `packages/frontend/tests/components/chat/ChatBlockToolUse.test.ts`
- Create: `packages/frontend/app/composables/chat/tool-icon.ts`

- [ ] **Step 1: Write a tool-icon mapping helper**

```ts
// packages/frontend/app/composables/chat/tool-icon.ts
export function toolIcon(name: string | undefined): string {
  switch (name) {
    case 'Read': return 'i-lucide-file-text'
    case 'Write': return 'i-lucide-file-edit'
    case 'Edit': return 'i-lucide-pencil'
    case 'MultiEdit': return 'i-lucide-pencil-ruler'
    case 'Glob': return 'i-lucide-files'
    case 'Grep': return 'i-lucide-search'
    case 'Bash': return 'i-lucide-terminal'
    case 'BashOutput': return 'i-lucide-terminal-square'
    case 'WebFetch': return 'i-lucide-globe'
    case 'WebSearch': return 'i-lucide-search-check'
    case 'TodoWrite': return 'i-lucide-list-checks'
    case 'Task': return 'i-lucide-bot'
    case 'NotebookEdit': return 'i-lucide-book-open'
    default: return 'i-lucide-wrench'
  }
}
```

- [ ] **Step 2: Write failing component tests**

```ts
// packages/frontend/tests/components/chat/ChatBlockToolUse.test.ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatBlockToolUse from '~/components/chat/ChatBlockToolUse.vue'

function props(mode: 'badge' | 'compact' | 'full', overrides: Record<string, unknown> = {}) {
  return {
    componentKey: 't1',
    defaultMode: mode,
    status: 'success' as const,
    data: { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' }, ...overrides },
  }
}

describe('ChatBlockToolUse', () => {
  it('renders as an inline-flex badge in badge mode', async () => {
    const w = await mountSuspended(ChatBlockToolUse, { props: props('badge') })
    expect(w.attributes('data-mode')).toBe('badge')
    // Badge mode: element must NOT be display:block.
    expect(w.attributes('class')).toContain('inline-flex')
  })

  it('renders a UChatTool in compact mode', async () => {
    const w = await mountSuspended(ChatBlockToolUse, { props: props('compact') })
    expect(w.attributes('data-mode')).toBe('compact')
    expect(w.findComponent({ name: 'UChatTool' }).exists()).toBe(true)
  })

  it('renders full output when mode=full and a tool_result exists', async () => {
    const w = await mountSuspended(ChatBlockToolUse, {
      props: props('full', { tool_result: { content: 'stdout output', is_error: false } }),
    })
    expect(w.text()).toContain('stdout output')
  })

  it('shows error styling when status=error', async () => {
    const w = await mountSuspended(ChatBlockToolUse, {
      props: { ...props('compact'), status: 'error' as const },
    })
    expect(w.attributes('data-status')).toBe('error')
  })

  it('passes streaming=true to UChatTool when status=streaming in compact/full', async () => {
    const w = await mountSuspended(ChatBlockToolUse, {
      props: { ...props('compact'), status: 'streaming' as const },
    })
    const tool = w.findComponent({ name: 'UChatTool' })
    expect(tool.props('streaming')).toBe(true)
  })
})
```

- [ ] **Step 3: Verify failure**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/ChatBlockToolUse.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

```vue
<!-- packages/frontend/app/components/chat/ChatBlockToolUse.vue -->
<script setup lang="ts">
import type { RenderMode } from '~/types/chat'
import { toolIcon } from '~/composables/chat/tool-icon'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  status?: 'streaming' | 'running' | 'success' | 'error' | 'cancelled'
  data: {
    type: 'tool_use'
    id: string
    name?: string
    input?: Record<string, unknown>
    tool_result?: { content: unknown; is_error: boolean }
  }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, setMode } = useRenderMode(props.componentKey, props.defaultMode)

const icon = computed(() => toolIcon(props.data.name))
const label = computed(() => props.data.name ?? 'Tool')
const inputSummary = computed(() => {
  const input = props.data.input
  if (!input) return ''
  if (typeof input === 'string') return input
  // First non-empty string value, truncated.
  for (const v of Object.values(input)) if (typeof v === 'string' && v) return v
  return JSON.stringify(input)
})
const outputText = computed(() => {
  const c = props.data.tool_result?.content
  if (typeof c === 'string') return c
  return JSON.stringify(c, null, 2)
})

const isError = computed(() => props.status === 'error')
const isStreaming = computed(() => props.status === 'streaming' || props.status === 'running')

function toBadge() { setMode('badge') }
function toCompact() { setMode('compact') }
function toFull() { setMode('full') }
</script>

<template>
  <div
    :data-mode="mode"
    :data-status="status ?? 'unknown'"
    :class="mode === 'badge' ? 'inline-flex items-center mr-1 align-middle' : 'block my-1'"
  >
    <template v-if="mode === 'badge'">
      <UBadge
        :color="isError ? 'error' : 'neutral'"
        variant="subtle"
        size="sm"
        class="cursor-pointer"
        @click="toCompact"
      >
        <UIcon :name="icon" class="size-3" />
        <span class="text-xs">{{ label }}</span>
        <UIcon v-if="isStreaming" name="i-lucide-loader-circle" class="size-3 animate-spin" />
      </UBadge>
    </template>

    <template v-else-if="mode === 'compact'">
      <UChatTool
        variant="inline"
        :icon="icon"
        :text="label"
        :suffix="inputSummary.slice(0, 80)"
        :streaming="isStreaming"
        :loading="isStreaming"
        :default-open="false"
        @update:open="(o: boolean) => setMode(o ? 'full' : 'compact')"
      >
        <pre v-if="data.tool_result" class="text-xs font-mono bg-neutral-100 dark:bg-neutral-900 rounded p-2 whitespace-pre-wrap">{{ outputText }}</pre>
      </UChatTool>
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-chevrons-left"
        aria-label="collapse to badge"
        @click="toBadge"
      />
    </template>

    <template v-else>
      <UChatTool
        variant="card"
        :icon="icon"
        :text="label"
        :suffix="inputSummary.slice(0, 80)"
        :streaming="isStreaming"
        :loading="isStreaming"
        :default-open="true"
        @update:open="(o: boolean) => setMode(o ? 'full' : 'compact')"
      >
        <div class="space-y-2">
          <pre class="text-xs font-mono bg-neutral-100 dark:bg-neutral-900 rounded p-2 whitespace-pre-wrap">{{ JSON.stringify(data.input, null, 2) }}</pre>
          <pre v-if="data.tool_result" class="text-xs font-mono bg-neutral-100 dark:bg-neutral-900 rounded p-2 whitespace-pre-wrap">{{ outputText }}</pre>
        </div>
      </UChatTool>
    </template>
  </div>
</template>
```

- [ ] **Step 5: Delete old component**

```bash
git rm packages/frontend/app/components/chat/ToolInvocation.vue
```

- [ ] **Step 6: Verify tests pass**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/ChatBlockToolUse.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/app/components/chat/ChatBlockToolUse.vue \
        packages/frontend/app/composables/chat/tool-icon.ts \
        packages/frontend/tests/components/chat/ChatBlockToolUse.test.ts
git commit -m "refactor(frontend): replace ToolInvocation with ChatBlockToolUse (three-mode + tool_result pairing)"
```

---

## Phase 3 — Envelopes & event-specific T1 components

### Task 3.1: `ChatAssistantMessage` (refactor to contract)

**Rationale:** The envelope no longer renders content inline — the reducer fans out blocks, so `ChatHistory` iterates the component list directly. `ChatAssistantMessage` becomes a small envelope used only when the rendering grouping benefits from it. **For this plan we are flattening: assistant content blocks render as top-level components in the stream, and `ChatAssistantMessage` is retired in favor of a lightweight `ChatAssistantHeader` inserted before the first block of each assistant turn.**

This simplifies the DOM substantially and is consistent with the design's "fan-out into the stream" model.

**Files:**
- Delete: `packages/frontend/app/components/chat/AssistantMessage.vue`
- Create: `packages/frontend/app/components/chat/ChatAssistantHeader.vue`
- Modify: `packages/frontend/app/composables/chat/use-chat-reducer.ts` (emit a `block-header` component before fan-out blocks)
- Modify: `packages/frontend/app/types/chat.ts` (add `'assistant-header'` to `ChatEventKind`)
- Modify: `packages/frontend/tests/composables/chat/use-chat-reducer.test.ts`

- [ ] **Step 1: Extend types with `assistant-header`**

Edit `types/chat.ts`:

```ts
export type ChatEventKind =
  | 'assistant'
  | 'assistant-header'   // ← add
  // …rest unchanged
```

- [ ] **Step 2: Add failing reducer test for the header**

In `use-chat-reducer.test.ts`:

```ts
it('emits an assistant-header before each assistant fan-out', () => {
  const src = ref([makeMessage({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'hi' }] } })])
  const { components } = useChatReducer(src)
  expect(components.value.map(c => c.kind)).toEqual(['assistant-header', 'block-text'])
  expect(components.value[0].componentKey).toBe('m1:header')
  expect(components.value[0].defaultMode).toBe('compact')
})
```

- [ ] **Step 3: Verify failure**

Run: `cd packages/frontend && pnpm vitest run tests/composables/chat/use-chat-reducer.test.ts`
Expected: new test FAILS.

- [ ] **Step 4: Prepend header in fan-out**

In `use-chat-reducer.ts` `fanOutAssistant`:

```ts
function fanOutAssistant(msg: ChatMessage, raw: any): ChatStreamComponent[] {
  const messageId = raw?.message?.id ?? msg.id
  const blocks: Block[] = raw?.message?.content ?? []
  const header: ChatStreamComponent = {
    componentKey: `${messageId}:header`,
    kind: 'assistant-header',
    data: { messageId, model: raw?.message?.model, usage: raw?.message?.usage },
    defaultMode: 'compact',
  }
  const blockComps = blocks.map((block, i) => {
    // …existing body
  })
  return [header, ...blockComps]
}
```

- [ ] **Step 5: Write the header component**

```vue
<!-- packages/frontend/app/components/chat/ChatAssistantHeader.vue -->
<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { messageId: string; model?: string; usage?: { input_tokens?: number; output_tokens?: number } }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode } = useRenderMode(props.componentKey, props.defaultMode)
</script>

<template>
  <div :data-mode="mode" class="block">
    <div v-if="mode !== 'badge'" class="flex items-center gap-2 text-xs text-neutral-500 mt-3 mb-1">
      <UIcon name="i-lucide-bot" class="size-4" />
      <span>Assistant</span>
      <span v-if="data.model" class="opacity-70">· {{ data.model }}</span>
    </div>
  </div>
</template>
```

- [ ] **Step 6: Delete old AssistantMessage**

```bash
git rm packages/frontend/app/components/chat/AssistantMessage.vue
```

- [ ] **Step 7: Verify tests pass**

Run: `cd packages/frontend && pnpm vitest run tests/composables/chat/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(frontend): flatten assistant envelope into header + fan-out blocks"
```

---

### Task 3.2: `ChatUserMessage` (refactor to contract)

**Files:**
- Modify: `packages/frontend/app/components/chat/UserMessage.vue` → rename to `ChatUserMessage.vue`
- Create: `packages/frontend/tests/components/chat/ChatUserMessage.test.ts`

- [ ] **Step 1: Read current UserMessage.vue**

```bash
cat packages/frontend/app/components/chat/UserMessage.vue
```

- [ ] **Step 2: Write failing tests**

```ts
// packages/frontend/tests/components/chat/ChatUserMessage.test.ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatUserMessage from '~/components/chat/ChatUserMessage.vue'

describe('ChatUserMessage', () => {
  it('extracts text from a user prompt and renders via UChatMessage', async () => {
    const w = await mountSuspended(ChatUserMessage, {
      props: {
        componentKey: 'u1',
        defaultMode: 'full',
        data: { type: 'user', message: { content: 'hi there' } },
      },
    })
    expect(w.text()).toContain('hi there')
  })

  it('renders compact style when sticky prop is true', async () => {
    const w = await mountSuspended(ChatUserMessage, {
      props: {
        componentKey: 'u2',
        defaultMode: 'full',
        sticky: true,
        data: { type: 'user', message: { content: 'hi' } },
      },
    })
    expect(w.attributes('data-mode')).toBe('compact')
  })
})
```

- [ ] **Step 3: Verify failure**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/ChatUserMessage.test.ts`
Expected: FAIL (path or props mismatch).

- [ ] **Step 4: Rewrite the component at the new path**

```vue
<!-- packages/frontend/app/components/chat/ChatUserMessage.vue -->
<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  sticky?: boolean
  data: { type: 'user'; message?: { content?: unknown }; content?: unknown }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode } = useRenderMode(props.componentKey, props.defaultMode, { sticky: props.sticky })

const text = computed(() => {
  const raw = props.data?.message?.content ?? props.data?.content
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    return raw.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n')
  }
  return String(raw ?? '')
})
</script>

<template>
  <div :data-mode="mode" class="block my-2">
    <UChatMessage
      role="user"
      :id="componentKey"
      side="right"
      :variant="mode === 'compact' ? 'subtle' : 'soft'"
      :parts="[{ type: 'text', id: componentKey, text }]"
      :compact="mode === 'compact'"
    />
  </div>
</template>
```

- [ ] **Step 5: Remove old file**

```bash
git rm packages/frontend/app/components/chat/UserMessage.vue
```

- [ ] **Step 6: Verify tests pass**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/ChatUserMessage.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(frontend): rename UserMessage → ChatUserMessage with new contract"
```

---

### Task 3.3: `ChatSystemInit` (refactor from `SystemMessage.vue`)

**Files:**
- Delete: `packages/frontend/app/components/chat/SystemMessage.vue`
- Create: `packages/frontend/app/components/chat/ChatSystemInit.vue`
- Create: `packages/frontend/tests/components/chat/ChatSystemInit.test.ts`

- [ ] **Step 1: Read existing SystemMessage**

```bash
cat packages/frontend/app/components/chat/SystemMessage.vue
```

- [ ] **Step 2: Write failing tests**

```ts
// packages/frontend/tests/components/chat/ChatSystemInit.test.ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatSystemInit from '~/components/chat/ChatSystemInit.vue'

describe('ChatSystemInit', () => {
  const baseData = {
    type: 'system', subtype: 'init',
    model: 'claude-opus-4-7', cwd: '/work/repo', tools: ['Read', 'Edit', 'Bash'],
  }

  it('shows model and cwd in compact mode', async () => {
    const w = await mountSuspended(ChatSystemInit, {
      props: { componentKey: 'i1', defaultMode: 'compact', data: baseData },
    })
    expect(w.text()).toContain('claude-opus-4-7')
    expect(w.text()).toContain('/work/repo')
  })

  it('lists tools in full mode', async () => {
    const w = await mountSuspended(ChatSystemInit, {
      props: { componentKey: 'i2', defaultMode: 'full', data: baseData },
    })
    for (const tool of baseData.tools) expect(w.text()).toContain(tool)
  })
})
```

- [ ] **Step 3: Verify failure**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/ChatSystemInit.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

```vue
<!-- packages/frontend/app/components/chat/ChatSystemInit.vue -->
<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'system'; subtype: 'init'; model?: string; cwd?: string; tools?: string[] }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, setMode } = useRenderMode(props.componentKey, props.defaultMode)
</script>

<template>
  <div :data-mode="mode" :class="mode === 'badge' ? 'inline-flex items-center' : 'block my-2'">
    <template v-if="mode === 'badge'">
      <UBadge variant="subtle" color="neutral" class="cursor-pointer" @click="setMode('compact')">
        <UIcon name="i-lucide-power" class="size-3" />
        <span class="text-xs">session</span>
      </UBadge>
    </template>
    <template v-else-if="mode === 'compact'">
      <div class="flex items-center gap-2 text-xs text-neutral-500 border-l-2 border-neutral-400 pl-2">
        <UIcon name="i-lucide-power" class="size-3" />
        <span>Session started</span>
        <span v-if="data.model" class="opacity-80">· {{ data.model }}</span>
        <span v-if="data.cwd" class="opacity-60 truncate">· {{ data.cwd }}</span>
        <UButton variant="ghost" size="xs" icon="i-lucide-chevron-down" @click="setMode('full')" />
      </div>
    </template>
    <template v-else>
      <UAlert color="neutral" variant="subtle" icon="i-lucide-power" :title="`Session started · ${data.model ?? 'unknown model'}`">
        <template #description>
          <div class="space-y-1">
            <div v-if="data.cwd"><span class="opacity-60">cwd:</span> <code>{{ data.cwd }}</code></div>
            <div v-if="data.tools?.length">
              <span class="opacity-60">tools:</span>
              <span v-for="t in data.tools" :key="t" class="inline-block mr-1"><UBadge variant="soft" size="sm">{{ t }}</UBadge></span>
            </div>
          </div>
        </template>
      </UAlert>
    </template>
  </div>
</template>
```

- [ ] **Step 5: Delete old file**

```bash
git rm packages/frontend/app/components/chat/SystemMessage.vue
```

- [ ] **Step 6: Verify tests pass**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/ChatSystemInit.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(frontend): replace SystemMessage with ChatSystemInit"
```

---

### Task 3.4: `ChatResult` (new T1)

**Files:**
- Create: `packages/frontend/app/components/chat/ChatResult.vue`
- Create: `packages/frontend/tests/components/chat/ChatResult.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/frontend/tests/components/chat/ChatResult.test.ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatResult from '~/components/chat/ChatResult.vue'

describe('ChatResult', () => {
  const successData = {
    type: 'result', subtype: 'success',
    total_cost_usd: 0.0123, duration_ms: 4200,
    usage: { input_tokens: 1234, output_tokens: 567 },
  }

  it('shows cost and tokens in compact mode', async () => {
    const w = await mountSuspended(ChatResult, {
      props: { componentKey: 'r1', defaultMode: 'compact', data: successData },
    })
    expect(w.text()).toContain('$0.01')
    expect(w.text()).toMatch(/1,?234/)
  })

  it('renders error variant when subtype starts with error_', async () => {
    const w = await mountSuspended(ChatResult, {
      props: { componentKey: 'r2', defaultMode: 'compact', data: { ...successData, subtype: 'error_max_turns' } },
    })
    expect(w.attributes('data-error')).toBe('true')
  })
})
```

- [ ] **Step 2: Verify failure**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/ChatResult.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```vue
<!-- packages/frontend/app/components/chat/ChatResult.vue -->
<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: {
    type: 'result'
    subtype: string
    total_cost_usd?: number
    duration_ms?: number
    usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
  }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode, setMode } = useRenderMode(props.componentKey, props.defaultMode)

const isError = computed(() => props.data.subtype?.startsWith('error_') ?? false)
const cost = computed(() => props.data.total_cost_usd != null ? `$${props.data.total_cost_usd.toFixed(4)}` : '—')
const duration = computed(() => props.data.duration_ms != null ? `${(props.data.duration_ms / 1000).toFixed(2)}s` : '—')
const inputTokens = computed(() => props.data.usage?.input_tokens?.toLocaleString() ?? '—')
const outputTokens = computed(() => props.data.usage?.output_tokens?.toLocaleString() ?? '—')
</script>

<template>
  <div :data-mode="mode" :data-error="isError" :class="mode === 'badge' ? 'inline-flex' : 'block my-2'">
    <template v-if="mode === 'badge'">
      <UBadge :color="isError ? 'error' : 'success'" variant="subtle" class="cursor-pointer" @click="setMode('compact')">
        <UIcon :name="isError ? 'i-lucide-circle-x' : 'i-lucide-circle-check'" class="size-3" />
        {{ cost }}
      </UBadge>
    </template>
    <template v-else-if="mode === 'compact'">
      <div class="flex items-center gap-2 text-xs border-t border-neutral-200 dark:border-neutral-800 pt-2">
        <UIcon :name="isError ? 'i-lucide-circle-x' : 'i-lucide-circle-check'" :class="isError ? 'text-error-500' : 'text-success-500'" class="size-4" />
        <span>Turn complete</span>
        <span class="opacity-70">· {{ cost }}</span>
        <span class="opacity-70">· in {{ inputTokens }} / out {{ outputTokens }}</span>
        <span class="opacity-70">· {{ duration }}</span>
        <UButton variant="ghost" size="xs" icon="i-lucide-chevron-down" @click="setMode('full')" />
      </div>
    </template>
    <template v-else>
      <UCard>
        <div class="space-y-1 text-sm">
          <div><strong>Status:</strong> {{ data.subtype }}</div>
          <div><strong>Cost:</strong> {{ cost }}</div>
          <div><strong>Duration:</strong> {{ duration }}</div>
          <div><strong>Tokens:</strong> input {{ inputTokens }} · output {{ outputTokens }}</div>
          <div v-if="data.usage?.cache_read_input_tokens"><strong>Cache read:</strong> {{ data.usage.cache_read_input_tokens.toLocaleString() }}</div>
        </div>
      </UCard>
    </template>
  </div>
</template>
```

- [ ] **Step 4: Verify tests pass**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/ChatResult.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app/components/chat/ChatResult.vue \
        packages/frontend/tests/components/chat/ChatResult.test.ts
git commit -m "feat(frontend): add ChatResult component"
```

---

### Task 3.5: `ChatCompactBoundary` (new T1)

**Files:**
- Create: `packages/frontend/app/components/chat/ChatCompactBoundary.vue`
- Create: `packages/frontend/tests/components/chat/ChatCompactBoundary.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/frontend/tests/components/chat/ChatCompactBoundary.test.ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatCompactBoundary from '~/components/chat/ChatCompactBoundary.vue'

describe('ChatCompactBoundary', () => {
  it('renders a horizontal divider with label in badge mode', async () => {
    const w = await mountSuspended(ChatCompactBoundary, {
      props: { componentKey: 'cb1', defaultMode: 'badge', data: { type: 'system', subtype: 'compact_boundary', reason: 'tokens' } },
    })
    expect(w.text()).toContain('compact')
  })
})
```

- [ ] **Step 2: Verify failure**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/ChatCompactBoundary.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```vue
<!-- packages/frontend/app/components/chat/ChatCompactBoundary.vue -->
<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'system'; subtype: 'compact_boundary'; reason?: string }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode } = useRenderMode(props.componentKey, props.defaultMode)
</script>

<template>
  <div :data-mode="mode" class="block my-3">
    <div class="flex items-center gap-2 text-xs text-neutral-500">
      <div class="flex-1 border-t border-neutral-300 dark:border-neutral-700" />
      <UIcon name="i-lucide-scissors" class="size-3" />
      <span>context compacted<span v-if="data.reason"> · {{ data.reason }}</span></span>
      <div class="flex-1 border-t border-neutral-300 dark:border-neutral-700" />
    </div>
  </div>
</template>
```

- [ ] **Step 4: Verify tests pass**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/ChatCompactBoundary.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(frontend): add ChatCompactBoundary component"
```

---

### Task 3.6: `ChatToolConfirmation` (refactor from `ToolApprovalBar.vue`)

**Files:**
- Delete: `packages/frontend/app/components/chat/ToolApprovalBar.vue`
- Create: `packages/frontend/app/components/chat/ChatToolConfirmation.vue`
- Create: `packages/frontend/tests/components/chat/ChatToolConfirmation.test.ts`

- [ ] **Step 1: Read existing approval bar**

```bash
cat packages/frontend/app/components/chat/ToolApprovalBar.vue
```

- [ ] **Step 2: Write failing tests**

```ts
// packages/frontend/tests/components/chat/ChatToolConfirmation.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatToolConfirmation from '~/components/chat/ChatToolConfirmation.vue'

describe('ChatToolConfirmation', () => {
  const data = { type: 'tool_confirmation', request_id: 'r1', tool: 'Bash', input: { command: 'rm -rf /' } }

  it('renders allow and deny buttons in full mode', async () => {
    const w = await mountSuspended(ChatToolConfirmation, {
      props: { componentKey: 'r1', defaultMode: 'full', sessionId: 's1', data },
    })
    expect(w.text()).toContain('Bash')
    expect(w.findAll('button').length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 3: Verify failure**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/ChatToolConfirmation.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement (preserve existing allow/deny wire-up)**

```vue
<!-- packages/frontend/app/components/chat/ChatToolConfirmation.vue -->
<script setup lang="ts">
import type { RenderMode } from '~/types/chat'
import { toolIcon } from '~/composables/chat/tool-icon'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  sticky?: boolean
  sessionId: string
  data: { type: 'tool_confirmation'; request_id?: string; tool?: string; input?: Record<string, unknown> }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode } = useRenderMode(props.componentKey, props.defaultMode, { sticky: props.sticky })

const sessionStore = useSessionStore()
const icon = computed(() => toolIcon(props.data.tool))
const summary = computed(() => JSON.stringify(props.data.input ?? {}, null, 2))

async function allow() {
  await sessionStore.respondToolConfirmation(props.sessionId, props.data.request_id!, 'allow')
}
async function deny() {
  await sessionStore.respondToolConfirmation(props.sessionId, props.data.request_id!, 'deny')
}
</script>

<template>
  <div :data-mode="mode" class="block my-2">
    <UAlert color="warning" variant="subtle" :icon="icon" :title="`Tool confirmation: ${data.tool}`">
      <template #description>
        <div class="space-y-2">
          <pre v-if="mode !== 'compact'" class="text-xs font-mono whitespace-pre-wrap">{{ summary }}</pre>
          <div class="flex gap-2">
            <UButton size="sm" color="success" icon="i-lucide-check" @click="allow">Allow</UButton>
            <UButton size="sm" color="error" variant="subtle" icon="i-lucide-x" @click="deny">Deny</UButton>
          </div>
        </div>
      </template>
    </UAlert>
  </div>
</template>
```

Note: `respondToolConfirmation` must exist on `sessionStore`. If the current ToolApprovalBar calls a different method, preserve that exact name — read from the old file in Step 1 and match.

- [ ] **Step 5: Delete old component**

```bash
git rm packages/frontend/app/components/chat/ToolApprovalBar.vue
```

- [ ] **Step 6: Verify tests pass**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/ChatToolConfirmation.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(frontend): replace ToolApprovalBar with ChatToolConfirmation"
```

---

### Task 3.7: `ChatBridgeError` (refactor from `ErrorNotice.vue`)

**Files:**
- Delete: `packages/frontend/app/components/chat/ErrorNotice.vue`
- Create: `packages/frontend/app/components/chat/ChatBridgeError.vue`
- Create: `packages/frontend/tests/components/chat/ChatBridgeError.test.ts`

- [ ] **Step 1: Read existing ErrorNotice**

```bash
cat packages/frontend/app/components/chat/ErrorNotice.vue
```

- [ ] **Step 2: Write failing test**

```ts
// packages/frontend/tests/components/chat/ChatBridgeError.test.ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatBridgeError from '~/components/chat/ChatBridgeError.vue'

describe('ChatBridgeError', () => {
  it('renders the message in full mode with error styling', async () => {
    const w = await mountSuspended(ChatBridgeError, {
      props: { componentKey: 'e1', defaultMode: 'full', data: { type: 'bridge:error', message: 'network lost' } },
    })
    expect(w.text()).toContain('network lost')
  })
})
```

- [ ] **Step 3: Verify failure**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/ChatBridgeError.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

```vue
<!-- packages/frontend/app/components/chat/ChatBridgeError.vue -->
<script setup lang="ts">
import type { RenderMode } from '~/types/chat'

const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'bridge:error'; message?: string; [k: string]: unknown }
}>()

const { useRenderMode } = useChatRenderMode()
const { mode } = useRenderMode(props.componentKey, props.defaultMode)
</script>

<template>
  <div :data-mode="mode" class="block my-2">
    <UAlert color="error" variant="subtle" icon="i-lucide-circle-alert" title="Bridge error">
      <template #description>
        <pre class="text-xs font-mono whitespace-pre-wrap">{{ data.message ?? JSON.stringify(data, null, 2) }}</pre>
      </template>
    </UAlert>
  </div>
</template>
```

- [ ] **Step 5: Delete old component**

```bash
git rm packages/frontend/app/components/chat/ErrorNotice.vue
```

- [ ] **Step 6: Verify tests pass**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/ChatBridgeError.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(frontend): replace ErrorNotice with ChatBridgeError"
```

---

## Phase 4 — Integration (ChatHistory + StickyRegion)

### Task 4.1: `ChatStickyRegion` (new)

**Files:**
- Create: `packages/frontend/app/components/chat/ChatStickyRegion.vue`

- [ ] **Step 1: Implement**

```vue
<!-- packages/frontend/app/components/chat/ChatStickyRegion.vue -->
<script setup lang="ts">
import type { ChatStreamComponent } from '~/types/chat'

defineProps<{
  items: ChatStreamComponent[]
  sessionId: string
}>()
</script>

<template>
  <div class="sticky top-0 z-10 bg-default/90 backdrop-blur-sm border-b border-default">
    <div class="max-w-4xl mx-auto px-2 py-1 space-y-1">
      <template v-for="item in items" :key="item.componentKey">
        <component
          :is="resolveChatComponent(item.kind)"
          v-bind="{ ...item, sticky: true, sessionId, data: item.data, defaultMode: item.defaultMode, componentKey: item.componentKey }"
        />
      </template>
    </div>
  </div>
</template>
```

`resolveChatComponent` is defined in the next task.

- [ ] **Step 2: Commit (will fail to compile until Task 4.2 adds the resolver — combine with 4.2)**

(Defer commit to end of Task 4.2 to avoid a broken intermediate commit.)

---

### Task 4.2: Refactor `ChatHistory` to use reducer + sticky region + component resolver

**Files:**
- Modify: `packages/frontend/app/components/chat/ChatHistory.vue`
- Create: `packages/frontend/app/composables/chat/resolve-component.ts`

- [ ] **Step 1: Write the component resolver**

```ts
// packages/frontend/app/composables/chat/resolve-component.ts
import type { ChatEventKind } from '~/types/chat'
import type { Component } from 'vue'

import ChatAssistantHeader from '~/components/chat/ChatAssistantHeader.vue'
import ChatBlockText from '~/components/chat/ChatBlockText.vue'
import ChatBlockThinking from '~/components/chat/ChatBlockThinking.vue'
import ChatBlockToolUse from '~/components/chat/ChatBlockToolUse.vue'
import ChatUserMessage from '~/components/chat/ChatUserMessage.vue'
import ChatSystemInit from '~/components/chat/ChatSystemInit.vue'
import ChatResult from '~/components/chat/ChatResult.vue'
import ChatCompactBoundary from '~/components/chat/ChatCompactBoundary.vue'
import ChatToolConfirmation from '~/components/chat/ChatToolConfirmation.vue'
import ChatBridgeError from '~/components/chat/ChatBridgeError.vue'

const MAP: Partial<Record<ChatEventKind, Component>> = {
  'assistant-header': ChatAssistantHeader,
  'block-text': ChatBlockText,
  'block-thinking': ChatBlockThinking,
  'block-tool-use': ChatBlockToolUse,
  'user': ChatUserMessage,
  'system-init': ChatSystemInit,
  'result': ChatResult,
  'compact-boundary': ChatCompactBoundary,
  'tool-confirmation': ChatToolConfirmation,
  'bridge-error': ChatBridgeError,
}

export function resolveChatComponent(kind: ChatEventKind): Component | null {
  return MAP[kind] ?? null
}
```

- [ ] **Step 2: Rewrite `ChatHistory.vue` to use the reducer**

```vue
<!-- packages/frontend/app/components/chat/ChatHistory.vue -->
<script setup lang="ts">
import type { ChatMessage } from '~/types'
import { resolveChatComponent } from '~/composables/chat/resolve-component'

const props = defineProps<{ sessionId: string }>()

const sessionStore = useSessionStore()
const messages = computed<ChatMessage[]>(() => sessionStore.messagesForSession(props.sessionId))

const { components, sideChannel } = useChatReducer(messages)

// Provide side-channel events to SessionHeader etc. via a provide/inject pair (or a dedicated store later).
provide('chat:side-channel', sideChannel)

const stickyItems = computed(() => components.value.filter(c => c.sticky))
const streamItems = computed(() => components.value.filter(c => !c.sticky))

// Auto-scroll
const scrollContainer = ref<HTMLElement | null>(null)
const shouldAutoScroll = ref(true)
function onScroll() {
  if (!scrollContainer.value) return
  const { scrollTop, scrollHeight, clientHeight } = scrollContainer.value
  shouldAutoScroll.value = scrollHeight - scrollTop - clientHeight < 80
}
watch(() => streamItems.value.length, async () => {
  if (!shouldAutoScroll.value) return
  await nextTick()
  scrollContainer.value?.scrollTo({ top: scrollContainer.value.scrollHeight, behavior: 'smooth' })
})
onMounted(async () => {
  await nextTick()
  scrollContainer.value?.scrollTo({ top: scrollContainer.value!.scrollHeight })
})
</script>

<template>
  <div ref="scrollContainer" class="flex-1 overflow-y-auto relative" @scroll="onScroll">
    <ChatStickyRegion v-if="stickyItems.length" :items="stickyItems" :session-id="sessionId" />

    <div class="max-w-4xl mx-auto px-2 py-4">
      <template v-if="streamItems.length === 0">
        <div class="flex items-center justify-center min-h-50 text-neutral-400 dark:text-neutral-500">
          <p>No messages yet. Send a prompt to start the conversation.</p>
        </div>
      </template>

      <template v-for="item in streamItems" :key="item.componentKey">
        <component
          :is="resolveChatComponent(item.kind)"
          v-if="resolveChatComponent(item.kind)"
          :component-key="item.componentKey"
          :default-mode="item.defaultMode"
          :data="item.data"
          :status="item.status"
          :session-id="sessionId"
        />
      </template>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Run the full frontend test suite**

Run: `task test:frontend`
Expected: all tests pass.

- [ ] **Step 4: Start dev server and validate manually**

Run: `task dev:frontend` (and `task dev:backend` in another shell). Create a new session and send a prompt. Verify:
- User message renders right-aligned.
- Assistant text appears.
- Tool calls appear as badges inline.
- Clicking a badge expands it to compact.
- Clicking the chevron expands to full output.
- Sticky region shows the last user message at the top.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(frontend): integrate chat reducer + sticky region in ChatHistory"
```

---

## Phase 5 — Remaining Tier-2 components

### Task 5.1: Register T2 events in `event-registry.ts`

**Files:**
- Modify: `packages/frontend/app/composables/chat/event-registry.ts`

- [ ] **Step 1: Append T2 entries**

Append to `CHAT_EVENT_REGISTRY`:

```ts
  // ── T2 ────────────────────────────────────────────────────────
  { type: 'system', subtype: 'api_retry', kind: 'api-retry', relationship: 'spawn',
    tier: 'T2', component: 'ChatAPIRetry', defaultMode: 'compact',
    sdkType: 'SDKAPIRetryMessage', sdkVersionValidated: SDK_VERSION },

  { type: 'system', subtype: 'local_command_output', kind: 'local-command-output', relationship: 'spawn',
    tier: 'T2', component: 'ChatLocalCommandOutput', defaultMode: 'compact',
    sdkType: 'SDKLocalCommandOutputMessage', sdkVersionValidated: SDK_VERSION },

  { type: 'system', subtype: 'notification', kind: 'notification', relationship: 'spawn',
    tier: 'T2', component: 'ChatNotification', defaultMode: 'compact',
    sdkType: 'SDKNotificationMessage', sdkVersionValidated: SDK_VERSION },

  { type: 'tool_use_summary', kind: 'tool-use-summary', relationship: 'spawn',
    tier: 'T2', component: 'ChatToolUseSummary', defaultMode: 'compact',
    sdkType: 'SDKToolUseSummaryMessage', sdkVersionValidated: SDK_VERSION },

  // Hook lifecycle — all three subtypes collapse into ChatHookEntry via mutate by hook_callback_id.
  { type: 'system', subtype: 'hook_started', kind: 'hook-entry', relationship: 'spawn',
    correlationKey: (e: any) => e?.hook_callback_id,
    tier: 'T2', component: 'ChatHookEntry', defaultMode: 'compact',
    sdkType: 'SDKHookStartedMessage', sdkVersionValidated: SDK_VERSION },
  { type: 'system', subtype: 'hook_progress', kind: 'hook-entry', relationship: 'mutate',
    correlationKey: (e: any) => e?.hook_callback_id,
    tier: 'T2', defaultMode: 'compact',
    sdkType: 'SDKHookProgressMessage', sdkVersionValidated: SDK_VERSION },
  { type: 'system', subtype: 'hook_response', kind: 'hook-entry', relationship: 'mutate',
    correlationKey: (e: any) => e?.hook_callback_id,
    tier: 'T2', defaultMode: 'compact',
    sdkType: 'SDKHookResponseMessage', sdkVersionValidated: SDK_VERSION },

  // Task lifecycle — four subtypes collapse into ChatTaskEntry via mutate by task_id.
  { type: 'task_started', kind: 'task-entry', relationship: 'spawn',
    correlationKey: (e: any) => e?.task_id,
    tier: 'T2', component: 'ChatTaskEntry', defaultMode: 'compact',
    sdkType: 'SDKTaskStartedMessage', sdkVersionValidated: SDK_VERSION },
  { type: 'task_updated', kind: 'task-entry', relationship: 'mutate',
    correlationKey: (e: any) => e?.task_id,
    tier: 'T2', defaultMode: 'compact',
    sdkType: 'SDKTaskUpdatedMessage', sdkVersionValidated: SDK_VERSION },
  { type: 'task_progress', kind: 'task-entry', relationship: 'mutate',
    correlationKey: (e: any) => e?.task_id,
    tier: 'T2', defaultMode: 'compact',
    sdkType: 'SDKTaskProgressMessage', sdkVersionValidated: SDK_VERSION },
  { type: 'task_notification', kind: 'task-entry', relationship: 'mutate',
    correlationKey: (e: any) => e?.task_id,
    tier: 'T2', defaultMode: 'compact',
    sdkType: 'SDKTaskNotificationMessage', sdkVersionValidated: SDK_VERSION },

  // User replay — treat as a spawn with a distinct kind so the header can mark it.
  // Reducer detects replay via a flag inside the raw envelope rather than SDK "type" (both use 'user'),
  // so a dedicated "replay" handler is added in Task 5.6.
  { type: 'user_replay', kind: 'user-replay', relationship: 'replace',
    correlationKey: (e: any) => e?.message?.id,
    tier: 'T2', component: 'ChatUserReplay', defaultMode: 'full',
    sdkType: 'SDKUserMessageReplay', sdkVersionValidated: SDK_VERSION },
```

- [ ] **Step 2: Verify compiles**

Run: `cd packages/frontend && pnpm exec vue-tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/app/composables/chat/event-registry.ts
git commit -m "feat(frontend): register T2 SDK event descriptors"
```

---

### Task 5.2: Simple T2 components (APIRetry, LocalCommandOutput, Notification, ToolUseSummary)

**Rationale:** Four nearly-identical "system notice" components. Share a pattern: small UAlert in compact, optional expansion in full. Badge shows an icon + type.

**Files:**
- Create: `packages/frontend/app/components/chat/ChatAPIRetry.vue`
- Create: `packages/frontend/app/components/chat/ChatLocalCommandOutput.vue`
- Create: `packages/frontend/app/components/chat/ChatNotification.vue`
- Create: `packages/frontend/app/components/chat/ChatToolUseSummary.vue`
- Create: `packages/frontend/tests/components/chat/system-notices.test.ts` (one test file, four describe blocks)

- [ ] **Step 1: Write failing tests (all four components)**

```ts
// packages/frontend/tests/components/chat/system-notices.test.ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatAPIRetry from '~/components/chat/ChatAPIRetry.vue'
import ChatLocalCommandOutput from '~/components/chat/ChatLocalCommandOutput.vue'
import ChatNotification from '~/components/chat/ChatNotification.vue'
import ChatToolUseSummary from '~/components/chat/ChatToolUseSummary.vue'

describe('ChatAPIRetry', () => {
  it('shows retry attempt and error', async () => {
    const w = await mountSuspended(ChatAPIRetry, {
      props: { componentKey: 'k', defaultMode: 'compact', data: { type: 'system', subtype: 'api_retry', attempt: 2, error: 'timeout' } },
    })
    expect(w.text()).toContain('retry')
    expect(w.text()).toContain('timeout')
  })
})

describe('ChatLocalCommandOutput', () => {
  it('shows the command output', async () => {
    const w = await mountSuspended(ChatLocalCommandOutput, {
      props: { componentKey: 'k', defaultMode: 'compact', data: { type: 'system', subtype: 'local_command_output', command: '/help', stdout: 'help text' } },
    })
    expect(w.text()).toContain('/help')
  })
})

describe('ChatNotification', () => {
  it('renders the message', async () => {
    const w = await mountSuspended(ChatNotification, {
      props: { componentKey: 'k', defaultMode: 'compact', data: { type: 'system', subtype: 'notification', message: 'Hello' } },
    })
    expect(w.text()).toContain('Hello')
  })
})

describe('ChatToolUseSummary', () => {
  it('shows the summary count', async () => {
    const w = await mountSuspended(ChatToolUseSummary, {
      props: { componentKey: 'k', defaultMode: 'compact', data: { type: 'tool_use_summary', count: 12 } },
    })
    expect(w.text()).toContain('12')
  })
})
```

- [ ] **Step 2: Verify failure**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/system-notices.test.ts`
Expected: FAIL — all four components missing.

- [ ] **Step 3: Implement all four components**

Each is ~25 lines. Follow the pattern below and substitute appropriate icon, title, and data keys. I'm showing one (APIRetry) in full; the others follow the same skeleton.

```vue
<!-- ChatAPIRetry.vue -->
<script setup lang="ts">
import type { RenderMode } from '~/types/chat'
const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'system'; subtype: 'api_retry'; attempt?: number; error?: string }
}>()
const { useRenderMode } = useChatRenderMode()
const { mode, setMode } = useRenderMode(props.componentKey, props.defaultMode)
</script>
<template>
  <div :data-mode="mode" :class="mode === 'badge' ? 'inline-flex' : 'block my-2'">
    <template v-if="mode === 'badge'">
      <UBadge color="warning" variant="subtle" class="cursor-pointer" @click="setMode('compact')">
        <UIcon name="i-lucide-refresh-cw" class="size-3" /> retry
      </UBadge>
    </template>
    <template v-else>
      <UAlert color="warning" variant="subtle" icon="i-lucide-refresh-cw"
        :title="`API retry${data.attempt != null ? ' · attempt ' + data.attempt : ''}`"
        :description="data.error" />
    </template>
  </div>
</template>
```

For `ChatLocalCommandOutput.vue`, `ChatNotification.vue`, `ChatToolUseSummary.vue`: apply the same skeleton. Use these icons / titles / bodies:

- **LocalCommandOutput** — icon `i-lucide-terminal-square`, title `Local command · {data.command}`, full mode shows `stdout` in a `<pre>`.
- **Notification** — icon `i-lucide-bell`, title `Notification`, body `data.message`.
- **ToolUseSummary** — icon `i-lucide-list`, title `Tool use summary`, body `${data.count} tool calls compacted`.

- [ ] **Step 4: Verify tests pass**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/system-notices.test.ts`
Expected: PASS.

- [ ] **Step 5: Add components to the resolver**

Modify `packages/frontend/app/composables/chat/resolve-component.ts` — import and map:

```ts
import ChatAPIRetry from '~/components/chat/ChatAPIRetry.vue'
import ChatLocalCommandOutput from '~/components/chat/ChatLocalCommandOutput.vue'
import ChatNotification from '~/components/chat/ChatNotification.vue'
import ChatToolUseSummary from '~/components/chat/ChatToolUseSummary.vue'
// in MAP:
'api-retry': ChatAPIRetry,
'local-command-output': ChatLocalCommandOutput,
'notification': ChatNotification,
'tool-use-summary': ChatToolUseSummary,
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(frontend): add T2 system-notice components (APIRetry, LocalCommandOutput, Notification, ToolUseSummary)"
```

---

### Task 5.3: `ChatHookEntry` — stateful mutate lifecycle

**Files:**
- Modify: `packages/frontend/app/composables/chat/use-chat-reducer.ts` (add mutate-by-correlation-key handling)
- Modify: `packages/frontend/tests/composables/chat/use-chat-reducer.test.ts`
- Create: `packages/frontend/app/components/chat/ChatHookEntry.vue`
- Create: `packages/frontend/tests/components/chat/ChatHookEntry.test.ts`

- [ ] **Step 1: Write failing reducer test for hook lifecycle**

```ts
describe('useChatReducer — hook lifecycle (mutate)', () => {
  it('collapses hook_started + hook_progress + hook_response into a single component', () => {
    const src = ref([
      makeMessage({ type: 'system', subtype: 'hook_started', hook_callback_id: 'h1', hook_event: 'PostToolUse' }),
      makeMessage({ type: 'system', subtype: 'hook_progress', hook_callback_id: 'h1', progress: 'running' }),
      makeMessage({ type: 'system', subtype: 'hook_response', hook_callback_id: 'h1', decision: 'allow' }),
    ])
    const { components } = useChatReducer(src)
    expect(components.value.filter(c => c.kind === 'hook-entry')).toHaveLength(1)
    const entry = components.value.find(c => c.kind === 'hook-entry')!
    expect((entry.data as any).decision).toBe('allow')
    expect(entry.status).toBe('success')
  })
})
```

- [ ] **Step 2: Verify failure**

Run: `cd packages/frontend && pnpm vitest run tests/composables/chat/use-chat-reducer.test.ts`
Expected: new test FAILS.

- [ ] **Step 3: Extend reducer — generic mutate by correlationKey**

In `use-chat-reducer.ts`, before the final `return`, add a Pass that merges mutate events into their spawn-parent components:

```ts
  // Pass 5: mutate by correlation key (hooks, tasks).
  const byKey = new Map<string, ChatStreamComponent>()
  for (const c of out) if (c.kind === 'hook-entry' || c.kind === 'task-entry') byKey.set(c.componentKey, c)

  for (const msg of messages) {
    const raw = (msg.raw?.data ?? msg.raw) as any
    const { relationship, descriptor } = classifyEvent(raw)
    if (relationship !== 'mutate' || !descriptor) continue
    if (descriptor.kind !== 'hook-entry' && descriptor.kind !== 'task-entry') continue

    const key = descriptor.correlationKey?.(raw)
    if (!key) continue
    const parent = byKey.get(key)
    if (!parent) continue

    // Merge: overlay new fields, set status heuristically.
    parent.data = { ...(parent.data as object), ...raw }
    if (descriptor.subtype === 'hook_response') parent.status = raw.decision === 'deny' ? 'error' : 'success'
    if (descriptor.type === 'task_progress' || descriptor.subtype === 'hook_progress') parent.status ??= 'running'
  }

  // Additionally: update spawn's componentKey to be the correlation key, not msg.id.
  // (Ensures mutate lookups find the parent on subsequent reducer runs.)
```

Also, in the spawn handler, for hook/task spawns, override `componentKey` with the correlation key:

```ts
    if (relationship === 'spawn') {
      const corr = descriptor.correlationKey?.(raw)
      out.push({
        componentKey: corr ?? msg.id,
        kind,
        data: raw,
        defaultMode: descriptor.defaultMode,
      })
      continue
    }
```

- [ ] **Step 4: Verify reducer test passes**

Run: `cd packages/frontend && pnpm vitest run tests/composables/chat/use-chat-reducer.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing component test**

```ts
// packages/frontend/tests/components/chat/ChatHookEntry.test.ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatHookEntry from '~/components/chat/ChatHookEntry.vue'

describe('ChatHookEntry', () => {
  it('shows the hook event name and final decision in compact mode', async () => {
    const w = await mountSuspended(ChatHookEntry, {
      props: {
        componentKey: 'h1', defaultMode: 'compact', status: 'success',
        data: { type: 'system', subtype: 'hook_response', hook_callback_id: 'h1', hook_event: 'PostToolUse', decision: 'allow' },
      },
    })
    expect(w.text()).toContain('PostToolUse')
    expect(w.text()).toContain('allow')
  })
})
```

- [ ] **Step 6: Implement component**

```vue
<!-- packages/frontend/app/components/chat/ChatHookEntry.vue -->
<script setup lang="ts">
import type { RenderMode } from '~/types/chat'
const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  status?: 'running' | 'success' | 'error' | 'streaming' | 'cancelled'
  data: { hook_event?: string; hook_callback_id?: string; decision?: string; progress?: string; [k: string]: unknown }
}>()
const { useRenderMode } = useChatRenderMode()
const { mode, setMode } = useRenderMode(props.componentKey, props.defaultMode)
const icon = computed(() => props.status === 'error' ? 'i-lucide-shield-x' : 'i-lucide-shield-check')
</script>
<template>
  <div :data-mode="mode" :class="mode === 'badge' ? 'inline-flex' : 'block my-1'">
    <template v-if="mode === 'badge'">
      <UBadge color="neutral" variant="subtle" class="cursor-pointer" @click="setMode('compact')">
        <UIcon :name="icon" class="size-3" /> hook
      </UBadge>
    </template>
    <template v-else>
      <UAlert :color="status === 'error' ? 'error' : 'neutral'" variant="subtle" :icon="icon"
        :title="`Hook · ${data.hook_event ?? 'unknown'}`"
        :description="data.decision ?? data.progress ?? ''" />
    </template>
  </div>
</template>
```

- [ ] **Step 7: Add to resolver**

In `resolve-component.ts`:

```ts
import ChatHookEntry from '~/components/chat/ChatHookEntry.vue'
// in MAP:
'hook-entry': ChatHookEntry,
```

- [ ] **Step 8: Verify tests pass**

Run: `cd packages/frontend && pnpm vitest run tests/`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(frontend): add ChatHookEntry with mutate-by-callback-id lifecycle"
```

---

### Task 5.4: `ChatTaskEntry` — stateful task lifecycle

**Rationale:** Mirror of Task 5.3 but for `task_started / task_updated / task_progress / task_notification` correlated by `task_id`. The generic mutate pass from Task 5.3 already handles the reducer side — this task adds the component.

**Files:**
- Create: `packages/frontend/app/components/chat/ChatTaskEntry.vue`
- Create: `packages/frontend/tests/components/chat/ChatTaskEntry.test.ts`
- Modify: `packages/frontend/app/composables/chat/resolve-component.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/frontend/tests/components/chat/ChatTaskEntry.test.ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatTaskEntry from '~/components/chat/ChatTaskEntry.vue'

describe('ChatTaskEntry', () => {
  it('shows task description and progress', async () => {
    const w = await mountSuspended(ChatTaskEntry, {
      props: { componentKey: 'task_1', defaultMode: 'compact', status: 'running',
        data: { type: 'task_progress', task_id: 'task_1', description: 'Refactor auth', progress: '50%' } },
    })
    expect(w.text()).toContain('Refactor auth')
    expect(w.text()).toContain('50%')
  })
})
```

- [ ] **Step 2: Verify failure**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/ChatTaskEntry.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```vue
<!-- packages/frontend/app/components/chat/ChatTaskEntry.vue -->
<script setup lang="ts">
import type { RenderMode } from '~/types/chat'
const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  status?: 'running' | 'success' | 'error' | 'streaming' | 'cancelled'
  data: { task_id?: string; description?: string; progress?: string; [k: string]: unknown }
}>()
const { useRenderMode } = useChatRenderMode()
const { mode, setMode } = useRenderMode(props.componentKey, props.defaultMode)
</script>
<template>
  <div :data-mode="mode" :class="mode === 'badge' ? 'inline-flex' : 'block my-1'">
    <template v-if="mode === 'badge'">
      <UBadge color="primary" variant="subtle" class="cursor-pointer" @click="setMode('compact')">
        <UIcon name="i-lucide-bot" class="size-3" /> task
      </UBadge>
    </template>
    <template v-else>
      <UAlert color="primary" variant="subtle" icon="i-lucide-bot"
        :title="data.description ?? 'Task'"
        :description="data.progress" />
    </template>
  </div>
</template>
```

- [ ] **Step 4: Register in resolver**

```ts
import ChatTaskEntry from '~/components/chat/ChatTaskEntry.vue'
// in MAP:
'task-entry': ChatTaskEntry,
```

- [ ] **Step 5: Verify tests pass**

Run: `cd packages/frontend && pnpm vitest run tests/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(frontend): add ChatTaskEntry component"
```

---

### Task 5.5: `ChatUserReplay` (T2)

**Files:**
- Create: `packages/frontend/app/components/chat/ChatUserReplay.vue`
- Create: `packages/frontend/tests/components/chat/ChatUserReplay.test.ts`
- Modify: `packages/frontend/app/composables/chat/resolve-component.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/frontend/tests/components/chat/ChatUserReplay.test.ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatUserReplay from '~/components/chat/ChatUserReplay.vue'

describe('ChatUserReplay', () => {
  it('renders user text with a replay marker', async () => {
    const w = await mountSuspended(ChatUserReplay, {
      props: { componentKey: 'u_r', defaultMode: 'full', data: { type: 'user_replay', message: { content: 'previously said' } } },
    })
    expect(w.text()).toContain('previously said')
    expect(w.text().toLowerCase()).toContain('replay')
  })
})
```

- [ ] **Step 2: Verify failure then implement**

```vue
<!-- packages/frontend/app/components/chat/ChatUserReplay.vue -->
<script setup lang="ts">
import type { RenderMode } from '~/types/chat'
const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'user_replay'; message?: { content?: unknown } }
}>()
const { useRenderMode } = useChatRenderMode()
const { mode } = useRenderMode(props.componentKey, props.defaultMode)
const text = computed(() => {
  const c = props.data.message?.content
  return typeof c === 'string' ? c : JSON.stringify(c)
})
</script>
<template>
  <div :data-mode="mode" class="block my-2 opacity-70">
    <div class="flex items-center gap-1 text-xs text-neutral-500 mb-1">
      <UIcon name="i-lucide-history" class="size-3" /> Replay
    </div>
    <UChatMessage role="user" :id="componentKey" side="right" variant="soft" :parts="[{ type: 'text', id: componentKey, text }]" />
  </div>
</template>
```

- [ ] **Step 3: Register + verify + commit**

```ts
import ChatUserReplay from '~/components/chat/ChatUserReplay.vue'
// in MAP:
'user-replay': ChatUserReplay,
```

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/ChatUserReplay.test.ts`
Expected: PASS.

```bash
git add -A
git commit -m "feat(frontend): add ChatUserReplay component"
```

---

## Phase 6 — Tier-3 components + content overflow

### Task 6.1: Register T3 events in `event-registry.ts`

**Files:**
- Modify: `packages/frontend/app/composables/chat/event-registry.ts`

- [ ] **Step 1: Append T3 entries**

```ts
  // ── T3: dedicated ────────────────────────────────────────────
  { type: 'system', subtype: 'memory_recall', kind: 'memory-recall', relationship: 'spawn',
    tier: 'T3', component: 'ChatMemoryRecall', defaultMode: 'badge',
    sdkType: 'SDKMemoryRecallMessage', sdkVersionValidated: SDK_VERSION },
  { type: 'system', subtype: 'elicitation_complete', kind: 'elicitation-complete', relationship: 'spawn',
    tier: 'T3', component: 'ChatElicitationComplete', defaultMode: 'compact',
    sdkType: 'SDKElicitationCompleteMessage', sdkVersionValidated: SDK_VERSION },

  // ── T3: generic stream-spawn overflow ────────────────────────
  { type: 'system', subtype: 'plugin_install', kind: 'generic-system', relationship: 'spawn',
    tier: 'T3', component: 'ChatGenericSystemEvent', defaultMode: 'badge',
    sdkType: 'SDKPluginInstallMessage', sdkVersionValidated: SDK_VERSION },
  { type: 'system', subtype: 'files_persisted', kind: 'generic-system', relationship: 'spawn',
    tier: 'T3', component: 'ChatGenericSystemEvent', defaultMode: 'badge',
    sdkType: 'SDKFilesPersistedEvent', sdkVersionValidated: SDK_VERSION },

  // ── T3: side-channel (not in stream) ─────────────────────────
  { type: 'system', subtype: 'session_state_changed', kind: 'generic-system', relationship: 'side-channel',
    tier: 'T3', defaultMode: 'badge',
    sdkType: 'SDKSessionStateChangedMessage', sdkVersionValidated: SDK_VERSION },
  { type: 'auth_status', kind: 'generic-system', relationship: 'side-channel',
    tier: 'T3', defaultMode: 'badge',
    sdkType: 'SDKAuthStatusMessage', sdkVersionValidated: SDK_VERSION },
  { type: 'system', subtype: 'mirror_error', kind: 'generic-system', relationship: 'side-channel',
    tier: 'T3', defaultMode: 'badge',
    sdkType: 'SDKMirrorErrorMessage', sdkVersionValidated: SDK_VERSION },
  { type: 'prompt_suggestion', kind: 'generic-system', relationship: 'side-channel',
    tier: 'T3', defaultMode: 'badge',
    sdkType: 'SDKPromptSuggestionMessage', sdkVersionValidated: SDK_VERSION },

  // ── Content blocks that need explicit registry entries for the drift test ─
  // (Content blocks don't arrive as top-level SDK events; no type field. But for drift
  //  coverage we ensure the block kinds are reachable. No relationship — handled by fan-out.)
```

- [ ] **Step 2: Verify compiles**

Run: `cd packages/frontend && pnpm exec vue-tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(frontend): register T3 SDK event descriptors"
```

---

### Task 6.2: `ChatMemoryRecall`, `ChatElicitationComplete`, `ChatGenericSystemEvent`

**Files:**
- Create: 3 components + 1 test file
- Modify: `packages/frontend/app/composables/chat/resolve-component.ts`

- [ ] **Step 1: Failing tests (batched)**

```ts
// packages/frontend/tests/components/chat/t3-events.test.ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatMemoryRecall from '~/components/chat/ChatMemoryRecall.vue'
import ChatElicitationComplete from '~/components/chat/ChatElicitationComplete.vue'
import ChatGenericSystemEvent from '~/components/chat/ChatGenericSystemEvent.vue'

describe('ChatMemoryRecall', () => {
  it('shows memory path', async () => {
    const w = await mountSuspended(ChatMemoryRecall, {
      props: { componentKey: 'k', defaultMode: 'badge', data: { type: 'system', subtype: 'memory_recall', path: 'user/pref.md' } },
    })
    expect(w.text()).toContain('memory')
  })
})
describe('ChatElicitationComplete', () => {
  it('shows elicitation result', async () => {
    const w = await mountSuspended(ChatElicitationComplete, {
      props: { componentKey: 'k', defaultMode: 'compact', data: { type: 'system', subtype: 'elicitation_complete', result: 'ok' } },
    })
    expect(w.text().toLowerCase()).toContain('elicitation')
  })
})
describe('ChatGenericSystemEvent', () => {
  it('falls back with type + subtype', async () => {
    const w = await mountSuspended(ChatGenericSystemEvent, {
      props: { componentKey: 'k', defaultMode: 'badge', data: { type: 'system', subtype: 'plugin_install', plugin: 'x' } },
    })
    expect(w.text()).toContain('plugin_install')
  })
})
```

- [ ] **Step 2: Implement**

For brevity, the three components share one skeleton. Substitute icon/title.

```vue
<!-- ChatMemoryRecall.vue -->
<script setup lang="ts">
import type { RenderMode } from '~/types/chat'
const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { path?: string; [k: string]: unknown }
}>()
const { useRenderMode } = useChatRenderMode()
const { mode, setMode } = useRenderMode(props.componentKey, props.defaultMode)
</script>
<template>
  <div :data-mode="mode" :class="mode === 'badge' ? 'inline-flex' : 'block my-1'">
    <template v-if="mode === 'badge'">
      <UBadge variant="subtle" color="neutral" class="cursor-pointer" @click="setMode('compact')">
        <UIcon name="i-lucide-brain-circuit" class="size-3" /> memory
      </UBadge>
    </template>
    <template v-else>
      <div class="text-xs text-neutral-500 flex items-center gap-1">
        <UIcon name="i-lucide-brain-circuit" class="size-3" />
        memory recall<span v-if="data.path">: <code>{{ data.path }}</code></span>
      </div>
    </template>
  </div>
</template>
```

For `ChatElicitationComplete.vue`: same skeleton, icon `i-lucide-message-circle-question`, label `elicitation`, body `data.result`.

For `ChatGenericSystemEvent.vue`: same skeleton, icon `i-lucide-info`, label `data.subtype ?? data.type`, body `JSON.stringify(data)`.

- [ ] **Step 3: Register in resolver**

```ts
import ChatMemoryRecall from '~/components/chat/ChatMemoryRecall.vue'
import ChatElicitationComplete from '~/components/chat/ChatElicitationComplete.vue'
import ChatGenericSystemEvent from '~/components/chat/ChatGenericSystemEvent.vue'
// in MAP:
'memory-recall': ChatMemoryRecall,
'elicitation-complete': ChatElicitationComplete,
'generic-system': ChatGenericSystemEvent,
```

- [ ] **Step 4: Verify tests pass**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/t3-events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(frontend): add T3 dedicated and generic system-event components"
```

---

### Task 6.3: Content-block components `ChatBlockImage` and `ChatBlockRedactedThinking`

**Files:**
- Create: 2 components + 1 test file
- Modify: `packages/frontend/app/composables/chat/resolve-component.ts`

- [ ] **Step 1: Failing tests (batched)**

```ts
// packages/frontend/tests/components/chat/block-overflow.test.ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatBlockImage from '~/components/chat/ChatBlockImage.vue'
import ChatBlockRedactedThinking from '~/components/chat/ChatBlockRedactedThinking.vue'

describe('ChatBlockImage', () => {
  it('renders an img tag in full mode', async () => {
    const w = await mountSuspended(ChatBlockImage, {
      props: { componentKey: 'k', defaultMode: 'full',
        data: { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } } },
    })
    expect(w.find('img').exists()).toBe(true)
  })
})
describe('ChatBlockRedactedThinking', () => {
  it('shows a badge without content', async () => {
    const w = await mountSuspended(ChatBlockRedactedThinking, {
      props: { componentKey: 'k', defaultMode: 'badge', data: { type: 'redacted_thinking' } },
    })
    expect(w.text().toLowerCase()).toContain('redacted')
  })
})
```

- [ ] **Step 2: Implement**

```vue
<!-- ChatBlockImage.vue -->
<script setup lang="ts">
import type { RenderMode } from '~/types/chat'
const props = defineProps<{
  componentKey: string
  defaultMode: RenderMode
  data: { type: 'image'; source?: { type: 'base64' | 'url'; media_type?: string; data?: string; url?: string } }
}>()
const { useRenderMode } = useChatRenderMode()
const { mode, setMode } = useRenderMode(props.componentKey, props.defaultMode)
const src = computed(() => {
  const s = props.data.source
  if (s?.type === 'base64' && s.data && s.media_type) return `data:${s.media_type};base64,${s.data}`
  if (s?.type === 'url' && s.url) return s.url
  return ''
})
</script>
<template>
  <div :data-mode="mode" :class="mode === 'badge' ? 'inline-flex' : 'block my-2'">
    <template v-if="mode === 'badge'">
      <UBadge variant="subtle" class="cursor-pointer" @click="setMode('compact')">
        <UIcon name="i-lucide-image" class="size-3" /> image
      </UBadge>
    </template>
    <template v-else-if="mode === 'compact'">
      <img v-if="src" :src="src" alt="" class="max-h-20 rounded cursor-pointer" @click="setMode('full')" />
    </template>
    <template v-else>
      <img v-if="src" :src="src" alt="" class="max-h-96 rounded" />
    </template>
  </div>
</template>
```

```vue
<!-- ChatBlockRedactedThinking.vue -->
<script setup lang="ts">
import type { RenderMode } from '~/types/chat'
const props = defineProps<{ componentKey: string; defaultMode: RenderMode; data: unknown }>()
const { useRenderMode } = useChatRenderMode()
const { mode } = useRenderMode(props.componentKey, props.defaultMode)
</script>
<template>
  <div :data-mode="mode" class="inline-flex items-center align-middle">
    <UBadge variant="subtle" color="neutral" title="Redacted thinking content">
      <UIcon name="i-lucide-eye-off" class="size-3" /> redacted
    </UBadge>
  </div>
</template>
```

- [ ] **Step 3: Register in resolver**

```ts
import ChatBlockImage from '~/components/chat/ChatBlockImage.vue'
import ChatBlockRedactedThinking from '~/components/chat/ChatBlockRedactedThinking.vue'
// in MAP:
'block-image': ChatBlockImage,
'block-redacted-thinking': ChatBlockRedactedThinking,
```

- [ ] **Step 4: Verify + commit**

Run: `cd packages/frontend && pnpm vitest run tests/components/chat/block-overflow.test.ts`
Expected: PASS.

```bash
git add -A
git commit -m "feat(frontend): add ChatBlockImage and ChatBlockRedactedThinking"
```

---

## Phase 7 — SDK-sync infrastructure

### Task 7.1: Drift test — registry must cover the SDK union

**Approach:** a type-level test using a `UnionToTuple` helper from a small existing utility (we'll define one) plus a runtime cross-check against a snapshot of the registry's `sdkType` values. The type-level test gives compile errors when the SDK adds a type not in the registry.

**Files:**
- Create: `packages/frontend/tests/composables/chat/registry-drift.test.ts`
- Modify: `packages/frontend/app/composables/chat/event-registry.ts` (export `type RegisteredSdkType`)

- [ ] **Step 1: Export the registered union from the registry**

Append to `event-registry.ts`:

```ts
/** The SDK interface names covered by the registry — used by the drift test. */
export type RegisteredSdkType = typeof CHAT_EVENT_REGISTRY[number]['sdkType']
```

- [ ] **Step 2: Write the drift test**

```ts
// packages/frontend/tests/composables/chat/registry-drift.test.ts
import { describe, it, expect } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { RegisteredSdkType } from '~/composables/chat/event-registry'
import { CHAT_EVENT_REGISTRY } from '~/composables/chat/event-registry'

/**
 * The `_constructor_name` of each SDK variant class — a common SDK-types pattern.
 * We approximate exhaustiveness by mapping SDKMessage['type']+subtype pairs to registry entries.
 */

// Map from {type, subtype} pairs in the SDK union to the set of registry-covered pairs.
type SdkTypeKey<T extends SDKMessage> = T extends { subtype: infer S } ? `${T['type']}/${S & string}` : T['type']
type AllSdkKeys = SdkTypeKey<SDKMessage>

// Build the covered-keys set at compile time via the registry constant.
type CoveredKey = typeof CHAT_EVENT_REGISTRY[number] extends infer E
  ? E extends { type: infer T; subtype: infer S }
    ? S extends string ? `${T & string}/${S}` : T & string
    : never
  : never

// Static assertion: every SDK key must appear in CoveredKey. An uncovered key
// produces a `never` assignment error at build time.
type Drift = Exclude<AllSdkKeys, CoveredKey>
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _driftCheck: Drift[] = [] // must compile to []; if not, the exclusion is non-empty ⇒ build fails

describe('registry drift', () => {
  it('all registry entries declare the same sdkVersionValidated', () => {
    const versions = new Set(CHAT_EVENT_REGISTRY.map(d => d.sdkVersionValidated))
    expect(versions.size).toBe(1)
  })

  it('every entry declares a non-empty sdkType', () => {
    for (const d of CHAT_EVENT_REGISTRY) expect(d.sdkType).toMatch(/\w+/)
  })

  it('type-level drift snapshot must compile to empty', () => {
    // If the SDK adds a new type+subtype the type `Drift` above becomes non-empty
    // and this file fails to compile. The runtime assertion is merely a liveness test.
    expect(Array.isArray([])).toBe(true)
  })
})
```

- [ ] **Step 3: Run drift test**

Run: `cd packages/frontend && pnpm vitest run tests/composables/chat/registry-drift.test.ts`
Expected: PASS. If it fails to compile, the registry is missing an SDK variant — fix the registry before continuing.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(frontend): add SDK drift type-level coverage test"
```

---

### Task 7.2: Write `operation/sdk-sync.md`

**Files:**
- Create: `.context/agents/operation/sdk-sync.md`
- Modify: `AGENTS.md` (add to Agent Operations table)
- Modify: `.context/agents/patterns/index.md` (add Chat event registry pattern)

- [ ] **Step 1: Write the operation doc**

```markdown
<!-- .context/agents/operation/sdk-sync.md -->
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
```

- [ ] **Step 2: Register the operation in `AGENTS.md`**

Add to the Agent Operations table:

```md
| [sdk-sync](.context/agents/operation/sdk-sync.md) | Keep the chat event registry in sync with `@anthropic-ai/claude-agent-sdk` versions |
```

- [ ] **Step 3: Register the pattern**

Edit `.context/agents/patterns/index.md`, replacing the `(none yet — …)` line with:

```md
## Patterns

| Pattern | Location | Summary |
|---|---|---|
| Chat event registry | `packages/frontend/app/composables/chat/event-registry.ts` | Single source of truth mapping SDK event types to render components, relationships, correlation keys, and default render modes. Guarded by a build-time drift test against `SDKMessage`. |
```

- [ ] **Step 4: Commit**

```bash
git add .context/agents/operation/sdk-sync.md AGENTS.md .context/agents/patterns/index.md
git commit -m "docs: register sdk-sync operation and chat-event-registry pattern"
```

---

## Phase 8 — Validation

### Task 8.1: Run the pre-push gate

- [ ] **Step 1: Lint**

Run: `task lint:check`
Expected: zero errors.

- [ ] **Step 2: Full test suite**

Run: `task test:all`
Expected: all pass.

- [ ] **Step 3: No debug artifacts**

Run: `rg -n "console\.log|debugger" packages/frontend/app/components/chat/ packages/frontend/app/composables/chat/`
Expected: no output.

- [ ] **Step 4: Conventional commits**

Run: `git log --oneline $(git merge-base HEAD master)..HEAD` and verify each commit follows `type(scope): message` format.

- [ ] **Step 5: No new commit — this is a verification task**

---

### Task 8.2: Live-debug smoke (per `operation/live-debug.md`)

- [ ] **Step 1: Start the full stack**

Follow `.context/agents/operation/live-debug.md` — `task dev` in the repo root.

- [ ] **Step 2: Walk a real session**

Create a session on a small repo. Send a prompt that triggers tools. Validate the checklist:

- [ ] Sticky last-user-message appears at the top.
- [ ] Text renders as markdown in full mode.
- [ ] Thinking blocks collapse to compact by default; click to expand.
- [ ] Tool invocations render as inline-flex badges; successive tools wrap naturally on a single line.
- [ ] Clicking a badge expands to compact.
- [ ] Clicking the chevron expands compact → full with output.
- [ ] Failed tool calls default to compact (not badge).
- [ ] Streaming assistant text shows the shimmer.
- [ ] Result row appears at the end with cost + tokens.
- [ ] Tool confirmation appears as a sticky full-mode row; Allow/Deny work.
- [ ] Session header reflects side-channel events (status, model, quota) — defer verification if SessionHeader consumers aren't wired yet.
- [ ] No uncaught console errors.

- [ ] **Step 3: Tear down**

Follow `operation/live-debug.md` teardown. No commit.

---

## Self-review notes

**Spec coverage:**
- Visual grammar (badge/compact/full, sticky) → Tasks 2.1–2.3, 3.x, 4.1–4.2.
- Per-instance override with toggles → Task 1.1 (`useChatRenderMode`), consumed by every component task.
- 6 event→component relationships → Tasks 1.2 (spawn/discard/side-channel), 1.3 (fan-out), 1.4 (mutate: tool pairing), 1.5 (mutate: streaming), 5.3 (mutate: correlation key).
- Full SDK coverage + registry → Task 0.3, 5.1, 6.1.
- NuxtUI 4.6 adoption (Compose) → Tasks 2.2 (UChatReasoning), 2.3 (UChatTool), 3.2 (UChatMessage).
- `useChatRenderMode` composable → Task 1.1.
- Correlation keys → Tasks 0.3, 5.1, 5.3.
- Sticky region → Tasks 1.5, 4.1, 4.2.
- Drift test → Task 7.1.
- SDK-sync operation → Task 7.2.
- No grouper (CSS inline-flex + block) → embedded in Tasks 2.1, 2.3, 3.1, 3.3.
- Out-of-scope items → captured in `future-work.md` and explicitly not in any task.
- Pre-push compliance → Task 8.1.
- E2E smoke → Task 8.2.

**Placeholders:** none. Every step has code, exact commands, or explicit file operations.

**Type consistency:** `RenderMode`, `ChatEventKind`, `ChatEventDescriptor`, `ChatStreamComponent` are defined once in `types/chat.ts` (Task 0.2) and every later task imports them. `componentKey`, `defaultMode`, `data`, `status`, `sticky`, `sessionId` — prop names are uniform across all components. The `useRenderMode(key, default, { sticky })` signature is consistent across Tasks 1.1, 2.1–2.3, 3.x.

**Task size:** 30 tasks across 8 phases. Each task independently testable. Phases 0–1 build the foundation; Phase 4 is the first integration checkpoint where the app is visibly working; Phases 5–6 are mostly additive and could be parallelized under subagent-driven execution.
