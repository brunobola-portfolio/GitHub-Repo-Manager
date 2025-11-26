import { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext(null)

const STORAGE_KEY = 'github-repo-manager-theme'

export function ThemeProvider({ children }) {
    const [theme, setTheme] = useState(() => {
        // Check localStorage first
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem(STORAGE_KEY)
            if (saved === 'dark' || saved === 'light') {
                return saved
            }
            // Check system preference
            if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
                return 'dark'
            }
        }
        return 'light'
    })

    useEffect(() => {
        const root = document.documentElement
        
        if (theme === 'dark') {
            root.classList.add('dark')
        } else {
            root.classList.remove('dark')
        }
        
        localStorage.setItem(STORAGE_KEY, theme)
    }, [theme])

    // Listen for system preference changes
    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
        
        const handleChange = (e) => {
            const saved = localStorage.getItem(STORAGE_KEY)
            // Only auto-switch if user hasn't manually set a preference
            if (!saved) {
                setTheme(e.matches ? 'dark' : 'light')
            }
        }
        
        mediaQuery.addEventListener('change', handleChange)
        return () => mediaQuery.removeEventListener('change', handleChange)
    }, [])

    const toggleTheme = () => {
        setTheme(prev => prev === 'dark' ? 'light' : 'dark')
    }

    const value = {
        theme,
        isDark: theme === 'dark',
        toggleTheme,
        setTheme
    }

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

