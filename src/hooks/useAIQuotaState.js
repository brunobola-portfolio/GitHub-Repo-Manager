import { useEffect, useState } from 'react'
import { getAIQuotaState, subscribeAIQuotaState } from '../api/aiFetch'

/**
 * React subscription to the global AI quota gate exposed by `aiFetch`. Any
 * surface that fans out AI calls (AttentionFeed, narrative pills, AI
 * insights, …) can render a friendly inline notice using this hook instead
 * of inventing its own quota tracking.
 *
 * Returns null when the gate is open. When closed, returns the structured
 * payload the server emitted:
 *
 *   {
 *     feature: string,        // e.g. 'ai_queries'
 *     limit: number|null,
 *     used: number|null,
 *     resetAt: string|null,   // ISO timestamp
 *     upgradeTo: string|null, // e.g. 'pro'
 *     until: number,          // local Date.now()-relative TTL
 *     recordedAt: number,
 *   }
 */
export function useAIQuotaState() {
    const [state, setState] = useState(() => getAIQuotaState())

    useEffect(() => {
        // useState(getAIQuotaState) already gave us the gate snapshot at
        // render time. From here on, the subscribe callback drives every
        // update — no synchronous re-read needed (which would only narrow
        // an already-tiny render→effect race and cost a cascading render).
        const unsubscribe = subscribeAIQuotaState(() => {
            setState(getAIQuotaState())
        })
        return unsubscribe
    }, [])

    return state
}
