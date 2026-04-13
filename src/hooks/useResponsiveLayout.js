import { useState, useLayoutEffect, useCallback, useRef } from 'react'

const STORAGE_KEY = 'repo-manager-layout-prefs'
const BREAKPOINTS = {
  md: 768,
  xl: 1280,
}

function getDefaultMode(width) {
  if (width < BREAKPOINTS.md) return 'drawer'
  if (width < BREAKPOINTS.xl) return 'slim'
  return 'expanded'
}

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
  const initialWidth = typeof window !== 'undefined' ? window.innerWidth : 1280
  const initialMode = getDefaultMode(initialWidth)

  const [breakpointMode, setBreakpointMode] = useState(initialMode)
  const [overrides, setOverrides] = useState(() => loadPrefs())
  const prevBreakpointMode = useRef(initialMode)

  useLayoutEffect(() => {
    const mqMd = window.matchMedia(`(min-width: ${BREAKPOINTS.md}px)`)
    const mqXl = window.matchMedia(`(min-width: ${BREAKPOINTS.xl}px)`)

    function update() {
      const width = window.innerWidth
      const mode = getDefaultMode(width)
      setBreakpointMode(prev => {
        if (prev !== mode) {
          prevBreakpointMode.current = prev
        }
        return mode
      })
    }

    update()
    mqMd.addEventListener('change', update)
    mqXl.addEventListener('change', update)

    return () => {
      mqMd.removeEventListener('change', update)
      mqXl.removeEventListener('change', update)
    }
  }, [])

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
