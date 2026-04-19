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
