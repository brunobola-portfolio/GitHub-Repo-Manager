/* eslint-disable react-refresh/only-export-components */
import React from 'react'
import { render } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastProvider'
import { ToastContainer } from '@/components/ui/Toast'
import { useToast } from '@/hooks/useToast'

// Internal: pairs the provider with the container so tests can assert on
// rendered toast text. Using this makes the test behave like the real app
// (main.jsx wraps <ToastProvider> and App.jsx renders <ToastContainer>).
function ToastHarness({ children }) {
    return (
        <ToastProvider>
            <ToastContainerShim />
            {children}
        </ToastProvider>
    )
}

function ToastContainerShim() {
    const { toasts, dismissToast } = useToast()
    return <ToastContainer toasts={toasts} onDismiss={dismissToast} />
}

/**
 * renderWithProviders — wraps the element in a ToastProvider + ToastContainer
 * pair so tests can assert toast text lands in the DOM.
 *
 * Deliberately lightweight — components that need additional providers
 * (ThemeProvider, SelectionProvider, etc.) should compose their own wrapper
 * instead of us jamming every context here by default.
 */
export function renderWithProviders(ui, options = {}) {
    return render(ui, { wrapper: ToastHarness, ...options })
}

export { ToastHarness }
