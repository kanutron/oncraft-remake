/**
 * SDK Drift Test — Task 7.1
 *
 * Ensures every SDKMessage variant is covered by the registry (type-level) and
 * that registry metadata is internally consistent (runtime).
 *
 * HOW THE TYPE-LEVEL GUARD WORKS
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. `SdkTypeKey<T>` converts each SDKMessage member to a discriminant key:
 *    - Members with a `subtype` field  →  `"type/subtype"`
 *    - Members without a `subtype`     →  `"type"`
 *
 * 2. `AllSdkKeys` is the union of all such keys across the full SDKMessage union.
 *
 * 3. `CoveredKey` mirrors the same key shape for every entry in CHAT_EVENT_REGISTRY
 *    (Bridge-layer entries — tier BR, plus the virtual `user_replay` type — are
 *    excluded because they do not appear in SDKMessage).
 *
 * 4. `KnownCoalesced` lists SDK keys that are intentionally merged into a single
 *    registry entry. Currently the `result` entry covers all `result/*` subtypes
 *    (SDKResultSuccess + SDKResultError) because the render decision is identical.
 *    Add to this union when the SDK adds a new result subtype and the registry
 *    deliberately keeps a single `result` row.
 *
 * 5. `Drift = Exclude<AllSdkKeys, CoveredKey | KnownCoalesced>` MUST resolve to
 *    `never`. The line `const _driftCheck: [Drift] extends [never] ? true : false`
 *    is typed as `true`; if Drift is non-empty, TypeScript reports a type error
 *    here — which IS the intended drift signal.
 *
 * MAINTENANCE BURDEN (KnownCoalesced)
 * ─────────────────────────────────────────────────────────────────────────────
 * When the SDK adds a new `result` subtype (e.g. `error_max_context`) that should
 * still route to the same ChatResult component, add it to `KnownCoalesced` below.
 * When the SDK adds any other new type/subtype, add a registry entry and it will
 * automatically drop out of Drift.
 *
 * SDK version validated: see CHAT_EVENT_REGISTRY[*].sdkVersionValidated
 */
import { describe, expect, it } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { CHAT_EVENT_REGISTRY } from '~/composables/chat/event-registry'

// ── Type-level helpers ────────────────────────────────────────────────────────

/**
 * Converts a single SDKMessage member to its discriminant key:
 *   { type: 'system'; subtype: 'init' }  →  'system/init'
 *   { type: 'assistant' }                →  'assistant'
 */
type SdkTypeKey<T extends SDKMessage> = T extends { subtype: infer S extends string }
  ? `${T['type']}/${S}`
  : T['type']

/** All discriminant keys across the entire SDKMessage union. */
type AllSdkKeys = SdkTypeKey<SDKMessage>

/**
 * Registry entries that originate from the SDK (exclude bridge-layer and virtual
 * types: tier=BR, and the synthetic `user_replay` type created by the backend
 * before forwarding — neither appears in the SDKMessage union).
 */
type SdkRegistryEntry = (typeof CHAT_EVENT_REGISTRY)[number] extends infer E
  ? E extends { tier: 'BR' }
    ? never
    : E extends { type: 'user_replay' }
      ? never
      : E
  : never

/**
 * Discriminant keys produced by SDK-native registry entries.
 * Entries without a `subtype` produce just `"type"`.
 * Entries with a `subtype` produce `"type/subtype"`.
 */
type CoveredKey = SdkRegistryEntry extends infer E
  ? E extends { type: infer T extends string; subtype: infer S extends string }
    ? `${T}/${S}`
    : E extends { type: infer T extends string }
      ? T
      : never
  : never

/**
 * SDK keys intentionally coalesced into a single registry entry.
 *
 * `result` in the registry covers SDKResultSuccess and SDKResultError without
 * discriminating subtypes — both render via ChatResult with identical layout.
 * If a new `result` subtype appears, add it here (or add a registry row).
 */
type KnownCoalesced =
  | 'result/success'
  | 'result/error_during_execution'
  | 'result/error_max_turns'
  | 'result/error_max_budget_usd'
  | 'result/error_max_structured_output_retries'

/**
 * SDK keys NOT covered by the registry or KnownCoalesced.
 * Must resolve to `never` — any non-never value is a drift signal.
 */
type Drift = Exclude<AllSdkKeys, CoveredKey | KnownCoalesced>

/**
 * Type assertion: if Drift is non-empty, this line will produce a compile error
 * ("Type 'false' is not assignable to type 'true'") that pinpoints the gap.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _driftAssert: [Drift] extends [never] ? true : false = true

// ── Runtime tests ─────────────────────────────────────────────────────────────

describe('registry drift', () => {
  it('all registry entries declare the same sdkVersionValidated', () => {
    const versions = new Set(CHAT_EVENT_REGISTRY.map(d => d.sdkVersionValidated))
    expect(versions.size).toBe(1)
  })

  it('every entry declares a non-empty sdkType', () => {
    for (const d of CHAT_EVENT_REGISTRY) {
      expect(d.sdkType, `entry type=${d.type} subtype=${d.subtype}`).toMatch(/\w+/)
    }
  })

  it('type-level drift guard resolves to never (compile sentinel is true)', () => {
    // If the line `const _driftAssert = true` above compiles, Drift === never.
    // This runtime test is a documentary assertion — the real check is compile-time.
    expect(_driftAssert).toBe(true)
  })
})
