import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { ThemeProvider, useTheme } from '@/hooks/useTheme'

describe('useTheme', () => {
  let matchMediaMock

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()

    // Mock matchMedia
    matchMediaMock = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }

    window.matchMedia = vi.fn().mockImplementation(() => matchMediaMock)

    // Clear document classes
    document.documentElement.classList.remove('dark')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws error when used outside ThemeProvider', () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      renderHook(() => useTheme())
    }).toThrow('useTheme must be used within a ThemeProvider')

    consoleSpy.mockRestore()
  })

  it('initializes with system theme by default', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider
    })

    expect(result.current.theme).toBe('system')
    expect(result.current.isDark).toBe(false)
  })

  it('loads saved theme from localStorage', () => {
    localStorage.setItem('github-repo-manager-theme', 'dark')

    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider
    })

    expect(result.current.theme).toBe('dark')
    expect(result.current.isDark).toBe(true)
  })

  it('applies dark class to documentElement when dark', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider
    })

    act(() => {
      result.current.setTheme('dark')
    })

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('removes dark class when light', () => {
    document.documentElement.classList.add('dark')

    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider
    })

    act(() => {
      result.current.setTheme('light')
    })

    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('saves theme preference to localStorage', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider
    })

    act(() => {
      result.current.setTheme('dark')
    })

    expect(localStorage.getItem('github-repo-manager-theme')).toBe('dark')
  })

  it('toggles from light to dark', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider
    })

    act(() => {
      result.current.setTheme('light')
    })

    expect(result.current.isDark).toBe(false)

    act(() => {
      result.current.toggleTheme()
    })

    expect(result.current.theme).toBe('dark')
    expect(result.current.isDark).toBe(true)
  })

  it('toggles from dark to light', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider
    })

    act(() => {
      result.current.setTheme('dark')
    })

    expect(result.current.isDark).toBe(true)

    act(() => {
      result.current.toggleTheme()
    })

    expect(result.current.theme).toBe('light')
    expect(result.current.isDark).toBe(false)
  })

  it('toggles from system to opposite of resolved theme', () => {
    matchMediaMock.matches = false // System is light

    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider
    })

    expect(result.current.theme).toBe('system')
    expect(result.current.isDark).toBe(false)

    act(() => {
      result.current.toggleTheme()
    })

    expect(result.current.theme).toBe('dark')
    expect(result.current.isDark).toBe(true)
  })

  it('respects system preference when theme is system', () => {
    matchMediaMock.matches = true // System prefers dark

    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider
    })

    expect(result.current.theme).toBe('system')
    expect(result.current.isDark).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('listens to system preference changes', async () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider
    })

    act(() => {
      result.current.setTheme('system')
    })

    // Verify event listener was attached
    expect(matchMediaMock.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))

    // Simulate system preference change to dark
    matchMediaMock.matches = true
    const changeHandler = matchMediaMock.addEventListener.mock.calls[0][1]

    act(() => {
      changeHandler()
    })

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })
  })

  it('does not react to system changes when theme is not system', () => {
    // When the user explicitly sets theme=light or dark, switching the OS
    // preference must not flip the class back. The hook re-runs its effect
    // on every theme change, swapping the event handler — so we have to
    // read the *latest* handler that was attached, not the one from the
    // initial mount (which still had theme='system' closed over).
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider
    })

    act(() => {
      result.current.setTheme('light')
    })

    expect(document.documentElement.classList.contains('dark')).toBe(false)

    // Simulate system preference change to dark, using the handler attached
    // AFTER the theme switched to 'light'.
    matchMediaMock.matches = true
    const calls = matchMediaMock.addEventListener.mock.calls
    const latestHandler = calls[calls.length - 1][1]

    act(() => {
      latestHandler()
    })

    // Should still be light, not affected by system change — because the
    // current handler's closure has theme === 'light', so its guard
    // `if (theme === 'system')` fails and no class toggle happens.
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('cleans up event listener on unmount', () => {
    const { unmount } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider
    })

    expect(matchMediaMock.addEventListener).toHaveBeenCalled()

    unmount()

    expect(matchMediaMock.removeEventListener).toHaveBeenCalled()
  })

  it('ignores invalid localStorage values', () => {
    localStorage.setItem('github-repo-manager-theme', 'invalid-theme')

    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider
    })

    expect(result.current.theme).toBe('system')
  })

  it('provides all expected context values', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider
    })

    expect(result.current).toHaveProperty('theme')
    expect(result.current).toHaveProperty('isDark')
    expect(result.current).toHaveProperty('toggleTheme')
    expect(result.current).toHaveProperty('setTheme')
    expect(typeof result.current.toggleTheme).toBe('function')
    expect(typeof result.current.setTheme).toBe('function')
  })
})
