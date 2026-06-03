import { useState, useCallback } from 'react'
import { BREAKPOINTS, useMediaQuery } from './useMediaQuery'

const STORAGE_KEY = 'repo-manager-layout-prefs'

function loadPrefs() {
  if (typeof window === 'undefined' || !window.localStorage) return {}
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // localStorage unavailable
  }
}

export function useResponsiveLayout() {
  // Layout mode is derived from the shared useMediaQuery primitive rather than
  // reading window.innerWidth / matchMedia here — one breakpoint source of truth
  // (the BREAKPOINTS table) and no manual listener bookkeeping.
  const isMdUp = useMediaQuery(`(min-width: ${BREAKPOINTS.md}px)`)
  const isXlUp = useMediaQuery(`(min-width: ${BREAKPOINTS.xl}px)`)
  const breakpointMode = !isMdUp ? 'drawer' : !isXlUp ? 'slim' : 'expanded'

  const [overrides, setOverrides] = useState(() => loadPrefs())

  // Overrides only apply within the expanded breakpoint range
  const leftMode = overrides.left && breakpointMode === 'expanded'
    ? overrides.left
    : breakpointMode

  const rightMode = overrides.right && breakpointMode === 'expanded'
    ? overrides.right
    : breakpointMode

  const toggleLeft = useCallback(() => {
    setOverrides(prev => {
      const current = prev.left || breakpointMode
      const next = current === 'expanded' ? 'slim' : 'expanded'
      const updated = { ...prev, left: next }
      savePrefs(updated)
      return updated
    })
  }, [breakpointMode])

  const toggleRight = useCallback(() => {
    setOverrides(prev => {
      const current = prev.right || breakpointMode
      const next = current === 'expanded' ? 'slim' : 'expanded'
      const updated = { ...prev, right: next }
      savePrefs(updated)
      return updated
    })
  }, [breakpointMode])

  return { leftMode, rightMode, breakpointMode, toggleLeft, toggleRight }
}
