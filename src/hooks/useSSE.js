import { useState, useEffect, useRef, useCallback } from 'react'

const MAX_RECONNECT_DELAY = 30000
const BASE_RECONNECT_DELAY = 1000

export function useSSE(url) {
  const [events, setEvents] = useState([])
  const [connected, setConnected] = useState(false)
  const [lastPlanState, setLastPlanState] = useState(null)
  const esRef = useRef(null)
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef(null)
  const urlRef = useRef(url)
  urlRef.current = url

  const connect = useCallback(() => {
    const currentUrl = urlRef.current
    if (!currentUrl) return

    // Clean up existing connection
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }

    const es = new EventSource(currentUrl)
    esRef.current = es

    es.onopen = () => {
      setConnected(true)
      reconnectAttemptRef.current = 0
    }

    es.onerror = () => {
      setConnected(false)
      es.close()
      esRef.current = null

      // Exponential backoff reconnect
      const delay = Math.min(
        BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttemptRef.current),
        MAX_RECONNECT_DELAY
      )
      reconnectAttemptRef.current += 1
      reconnectTimerRef.current = setTimeout(connect, delay)
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
          setEvents(prev => {
            const updated = [...prev, { type, data, id: e.lastEventId }]
            return updated.length > 100 ? updated.slice(-100) : updated
          })
          if (type === 'catch-up') setLastPlanState(data)
        } catch {
          // Skip malformed events
        }
      })
    })
  }, [])

  useEffect(() => {
    connect()

    return () => {
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      setConnected(false)
    }
  }, [url, connect])

  const clearEvents = useCallback(() => setEvents([]), [])

  return { events, connected, lastPlanState, clearEvents }
}
