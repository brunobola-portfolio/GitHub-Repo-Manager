import { useState, useEffect, useCallback } from 'react'

/**
 * Hook to detect online/offline status with reconnection detection
 */
export function useOnlineStatus() {
    const [isOnline, setIsOnline] = useState(navigator.onLine)
    const [wasOffline, setWasOffline] = useState(false)
    
    useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true)
            // Track that we just came back online
            if (!navigator.onLine === false) {
                setWasOffline(true)
                // Reset wasOffline after a short delay
                setTimeout(() => setWasOffline(false), 5000)
            }
        }
        
        const handleOffline = () => {
            setIsOnline(false)
        }
        
        window.addEventListener('online', handleOnline)
        window.addEventListener('offline', handleOffline)
        
        return () => {
            window.removeEventListener('online', handleOnline)
            window.removeEventListener('offline', handleOffline)
        }
    }, [])
    
    // Function to check connectivity by pinging a resource
    const checkConnectivity = useCallback(async () => {
        try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 5000)
            
            // Ping a lightweight endpoint or use HEAD request
            const response = await fetch('/api/health', {
                method: 'HEAD',
                signal: controller.signal,
                cache: 'no-store'
            })
            
            clearTimeout(timeoutId)
            return response.ok
        } catch {
            return false
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

