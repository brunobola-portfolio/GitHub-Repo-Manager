import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'

const MAX_RECONNECT_DELAY = 30000
const BASE_RECONNECT_DELAY = 1000
const MAX_RECONNECT_ATTEMPTS = 5

export function useSSE(url) {
  const [events, setEvents] = useState([])
  const [connected, setConnected] = useState(false)
  const [reconnectExhausted, setReconnectExhausted] = useState(false)
  const [lastPlanState, setLastPlanState] = useState(null)

  const urlRef = useRef(url)
  const reconnectTimerRef = useRef(null)
  const reconnectAttemptRef = useRef(0)
  const eventSourceRef = useRef(null)
  const connectRef = useRef(null)
  // Monotonic sequence stamped on every event. The events array is a sliding
  // window capped at 100, so consumers MUST NOT use array length/index as a
  // cursor — once the window is full the length pins at 100 and length-based
  // consumers stop seeing new events (migrations emit 100+). `seq` always
  // increases, so a consumer can track "last seq processed" reliably.
  const seqRef = useRef(0)

  // Update URL ref on every render - moved to effect for React 19 compliance
  useLayoutEffect(() => {
    urlRef.current = url
  })

  const connect = useCallback(() => {
    const currentUrl = urlRef.current
    if (!currentUrl) return

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    const es = new EventSource(currentUrl)
    eventSourceRef.current = es

    es.onopen = () => {
      setConnected(true)
      reconnectAttemptRef.current = 0
      setReconnectExhausted(false)
    }

    es.onerror = () => {
      setConnected(false)
      es.close()
      eventSourceRef.current = null

      reconnectAttemptRef.current += 1
      if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setReconnectExhausted(true)
        return
      }

      // Exponential backoff reconnect
      const delay = Math.min(
        BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttemptRef.current),
        MAX_RECONNECT_DELAY
      )
      reconnectTimerRef.current = setTimeout(() => connectRef.current?.(), delay)
    }

    const eventTypes = [
      'task-progress', 'task-status', 'task-complete',
      'task-failed', 'plan-status', 'plan-complete',
      'catch-up', 'plan-interrupted'
    ]

    eventTypes.forEach(type => {
      es.addEventListener(type, (e) => {
        try {
          const data = JSON.parse(e.data)
          // Stamp seq OUTSIDE the updater — the listener runs once per real
          // event, whereas a setState updater can re-run under StrictMode.
          const seq = ++seqRef.current
          setEvents(prev => {
            const updated = [...prev, { type, data, id: e.lastEventId, seq }]
            return updated.length > 100 ? updated.slice(-100) : updated
          })
          if (type === 'catch-up') setLastPlanState(data)
        } catch {
          // Skip malformed events
        }
      })
    })
  }, []) // Stability is key, uses refs for current values

  useLayoutEffect(() => {
    connectRef.current = connect
  })

  useEffect(() => {
    connect()

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      setConnected(false)
    }
  }, [connect]) // url is handled via urlRef

  const clearEvents = useCallback(() => setEvents([]), [])

  return { events, connected, reconnectExhausted, lastPlanState, clearEvents }
}
