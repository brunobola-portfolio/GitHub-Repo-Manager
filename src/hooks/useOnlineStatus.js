import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * Hook to detect online/offline status with reconnection detection
 */
export function useOnlineStatus() {
    const [isOnline, setIsOnline] = useState(navigator.onLine)
    const [wasOffline, setWasOffline] = useState(false)
    const wasOfflineTimerRef = useRef(null)

    useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true)
            // Track that we just came back online
            setWasOffline(true)
            // Clear any existing timer before setting a new one
            if (wasOfflineTimerRef.current) {
                clearTimeout(wasOfflineTimerRef.current)
            }
            // Reset wasOffline after a short delay
            wasOfflineTimerRef.current = setTimeout(() => {
                setWasOffline(false)
                wasOfflineTimerRef.current = null
            }, 5000)
        }

        const handleOffline = () => {
            setIsOnline(false)
        }

        window.addEventListener('online', handleOnline)
        window.addEventListener('offline', handleOffline)

        return () => {
            window.removeEventListener('online', handleOnline)
            window.removeEventListener('offline', handleOffline)
            // Clean up timer on unmount
            if (wasOfflineTimerRef.current) {
                clearTimeout(wasOfflineTimerRef.current)
            }
        }
    }, [])

    // Function to check connectivity by pinging a resource
    const checkConnectivity = useCallback(async () => {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 5000)
        try {
            const response = await fetch('/api/health', {
                method: 'HEAD',
                signal: controller.signal,
                cache: 'no-store'
            })
            return response.ok
        } catch {
            return false
        } finally {
            clearTimeout(timeoutId)
        }
    }, [])

    return {
        isOnline,
        isOffline: !isOnline,
        wasOffline,
        checkConnectivity
    }
}

export default useOnlineStatus
