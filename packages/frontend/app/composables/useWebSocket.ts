import type { SessionState } from '~/types'

export function useWebSocket() {
  const config = useRuntimeConfig()
  const sessionStore = useSessionStore()
  const connected = ref(false)
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectDelay = 1000

  function connect() {
    ws = new WebSocket(config.public.wsUrl)

    ws.onopen = () => {
      connected.value = true
      reconnectDelay = 1000
    }

    ws.onclose = () => {
      connected.value = false
      scheduleReconnect()
    }

    ws.onerror = () => {
      ws?.close()
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        handleEvent(msg)
      } catch { /* ignore non-JSON */ }
    }
  }

  function handleEvent(msg: Record<string, unknown>) {
    const sessionId = msg.sessionId as string | undefined

    switch (msg.event) {
      case 'session:message':
        if (sessionId) {
          if (msg.type === 'bridge:history') {
            const list = (msg.messages ?? []) as Record<string, unknown>[]
            sessionStore.appendHistoryMessages(sessionId, list)
          }
          else if (msg.type === 'bridge:subagents') {
            const entries = (msg.entries ?? []) as {
              agentId: string
              agentType?: string
              description?: string
              messages: Record<string, unknown>[]
            }[]
            sessionStore.setSubagents(sessionId, entries)
          }
          else {
            sessionStore.appendMessage(sessionId, msg)
          }
        }
        break
      case 'session:state-changed':
        if (sessionId) {
          const to = msg.to as string
          sessionStore.updateState(sessionId, to as SessionState)
        }
        break
      case 'session:deleted': {
        const deletedSessionId = msg.sessionId as string
        const deletedRepoId = msg.repositoryId as string
        if (deletedSessionId && deletedRepoId) {
          sessionStore.removeSession(deletedSessionId, deletedRepoId)
        }
        break
      }
    }
  }

  function send(command: Record<string, unknown>) {
    ws?.send(JSON.stringify(command))
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(() => {
      connect()
      reconnectDelay = Math.min(reconnectDelay * 2, 30000)
    }, reconnectDelay)
  }

  function disconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    ws?.close()
    ws = null
  }

  return { connected, connect, disconnect, send }
}
