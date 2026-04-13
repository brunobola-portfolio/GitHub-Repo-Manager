import { useState, useEffect } from 'react'

// TODO: Consider consolidating with useResponsiveLayout which provides
// richer breakpoint info (drawer/slim/expanded). This hook overlaps with
// useResponsiveLayout's breakpointMode === 'drawer' check. Skipping
// refactor for now due to multiple consumers (CreateRepoModal, MigrationWizard).
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
