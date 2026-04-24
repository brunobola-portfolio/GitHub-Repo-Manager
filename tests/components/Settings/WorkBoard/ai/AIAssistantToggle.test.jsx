import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockHook = {
    prefs: { ai_assistant_enabled: 0, ai_monthly_cap_cents: 500 },
    updatePrefs: vi.fn().mockResolvedValue({}),
}
vi.mock('../../../../../src/hooks/useTrackedRepos', () => ({
    useTrackedRepos: () => mockHook,
}))

const { AIAssistantToggle } = await import('../../../../../src/components/Settings/WorkBoard/ai/AIAssistantToggle')

beforeEach(() => {
    mockHook.updatePrefs.mockClear()
    mockHook.prefs = { ai_assistant_enabled: 0, ai_monthly_cap_cents: 500 }
})

describe('AIAssistantToggle', () => {
    it('renders as off when ai_assistant_enabled=0', () => {
        render(<AIAssistantToggle />)
        const toggle = screen.getByRole('switch', { name: /enable ai assistant/i })
        expect(toggle.getAttribute('aria-checked')).toBe('false')
    })

    it('clicking toggle calls updatePrefs with ai_assistant_enabled=1', async () => {
        render(<AIAssistantToggle />)
        fireEvent.click(screen.getByRole('switch', { name: /enable ai assistant/i }))
        await waitFor(() => expect(mockHook.updatePrefs).toHaveBeenCalledWith({ ai_assistant_enabled: 1 }))
    })

    it('shows the cap selector with current value', () => {
        mockHook.prefs = { ai_assistant_enabled: 1, ai_monthly_cap_cents: 500 }
        render(<AIAssistantToggle />)
        const select = screen.getByLabelText(/monthly cap/i)
        expect(select.value).toBe('500')
    })

    it('changing cap calls updatePrefs with ai_monthly_cap_cents', async () => {
        mockHook.prefs = { ai_assistant_enabled: 1, ai_monthly_cap_cents: 500 }
        render(<AIAssistantToggle />)
        fireEvent.change(screen.getByLabelText(/monthly cap/i), { target: { value: '2000' } })
        await waitFor(() => expect(mockHook.updatePrefs).toHaveBeenCalledWith({ ai_monthly_cap_cents: 2000 }))
    })
})
