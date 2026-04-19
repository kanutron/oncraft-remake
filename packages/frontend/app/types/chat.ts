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
  | 'assistant-header'
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
