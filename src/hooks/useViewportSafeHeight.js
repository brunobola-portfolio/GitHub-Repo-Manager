// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react'

/**
 * useViewportSafeHeight — returns the visual viewport height that accounts
 * for browser chrome collapse on mobile (e.g. iOS Safari URL bar shrinks on
 * scroll). Used by mobile sheets / full-height modals so they don't render
 * underneath the address bar.
 *
 * Falls back to `window.innerHeight` when `visualViewport` is unavailable
 * (older browsers, SSR). Returns 0 in non-browser environments.
 *
 * @returns {number} pixel height
 */
export function useViewportSafeHeight() {
	const [h, setH] = useState(() => {
		if (typeof window === 'undefined') return 0
		return window.visualViewport?.height ?? window.innerHeight
	})

	useEffect(() => {
		if (typeof window === 'undefined') return
		const vv = window.visualViewport
		if (!vv) return
		const update = () => setH(vv.height)
		vv.addEventListener('resize', update)
		return () => vv.removeEventListener('resize', update)
	}, [])

	return h
}
