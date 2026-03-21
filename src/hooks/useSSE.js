import { useState, useEffect, useRef, useCallback } from 'react'

export function useSSE(url) {
  const [events, setEvents] = useState([])
  const [connected, setConnected] = useState(false)
  const [lastPlanState, setLastPlanState] = useState(null)
  const esRef = useRef(null)

  useEffect(() => {
    if (!url) return
    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

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

    return () => { es.close(); setConnected(false) }
  }, [url])

  const clearEvents = useCallback(() => setEvents([]), [])

  return { events, connected, lastPlanState, clearEvents }
}
