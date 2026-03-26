import { useState, useEffect } from 'react'

const MOBILE_QUERY = '(max-width: 767px)'

export function useMobileBreakpoint() {
    const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)

    useEffect(() => {
        const mql = window.matchMedia(MOBILE_QUERY)
        const onChange = (e) => setIsMobile(e.matches)
        mql.addEventListener('change', onChange)
        return () => mql.removeEventListener('change', onChange)
    }, [])

    return isMobile
}
