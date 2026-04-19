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
  // so a dedicated "replay" handler is added in Task 5.5.
  { type: 'user_replay', kind: 'user-replay', relationship: 'replace',
    correlationKey: (e: any) => e?.message?.id,
    tier: 'T2', component: 'ChatUserReplay', defaultMode: 'full',
    sdkType: 'SDKUserMessageReplay', sdkVersionValidated: SDK_VERSION },
]

/** Find the descriptor matching a raw event, or null if unknown. */
export function findDescriptor(type: string, subtype?: string): ChatEventDescriptor | null {
  return CHAT_EVENT_REGISTRY.find(
    d => d.type === type && (d.subtype === undefined || d.subtype === subtype),
  ) ?? null
}
