import { useContext } from 'react'
import { TierContext } from '../contexts/contexts'

// Read the current license tier ('free' | 'pro' | 'enterprise') from
// the app-level TierContext. Used by hooks that need to skip Pro-gated
// fetches on Free tier so the browser doesn't log a 403 to the console.
export function useTier() {
    return useContext(TierContext)
}

export function isProOrAbove(tier) {
    return tier === 'pro' || tier === 'enterprise'
}
