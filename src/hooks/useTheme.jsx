/* eslint-disable react-refresh/only-export-components */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const ThemeContext = createContext(null)

const STORAGE_KEY = 'github-repo-manager-theme'

function resolveTheme(theme) {
    if (theme === 'system') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return theme
}

export function ThemeProvider({ children }) {
    const [theme, setTheme] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem(STORAGE_KEY)
            if (saved === 'dark' || saved === 'light' || saved === 'system') {
                return saved
            }
        }
        return 'system'
    })

    const resolved = resolveTheme(theme)

    useEffect(() => {
        const root = document.documentElement

        if (resolved === 'dark') {
            root.classList.add('dark')
        } else {
            root.classList.remove('dark')
        }

        localStorage.setItem(STORAGE_KEY, theme)
    }, [theme, resolved])

    // Listen for system preference changes (relevant when theme === 'system')
    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

        const handleChange = () => {
            if (theme === 'system') {
                const root = document.documentElement
                if (mediaQuery.matches) {
                    root.classList.add('dark')
                } else {
                    root.classList.remove('dark')
                }
            }
        }

        mediaQuery.addEventListener('change', handleChange)
        return () => mediaQuery.removeEventListener('change', handleChange)
    }, [theme])

    const toggleTheme = useCallback(() => {
        setTheme(prev => {
            const current = resolveTheme(prev)
            return current === 'dark' ? 'light' : 'dark'
        })
    }, [])

    // useMemo so the context object identity is stable across renders that
    // don't actually change theme/resolved — without this, every consumer of
    // useTheme() re-renders on any ancestor re-render.
    const value = useMemo(() => ({
        theme,
        isDark: resolved === 'dark',
        toggleTheme,
        setTheme
    }), [theme, resolved, toggleTheme])

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    )
}

export function useTheme() {
    const context = useContext(ThemeContext)
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider')
    }
    return context
}

