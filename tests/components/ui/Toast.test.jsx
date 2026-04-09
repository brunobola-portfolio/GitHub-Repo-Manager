import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Toast } from '@/components/ui/Toast'

describe('Toast', () => {
    it('renders string message by default', () => {
        render(<Toast id={1} type="info" message="Hello" onDismiss={vi.fn()} duration={0} />)
        expect(screen.getByText('Hello')).toBeInTheDocument()
    })

    it('renders custom content when provided and ignores message', () => {
        render(
            <Toast
                id={1}
                type="warning"
                message="should-not-show"
                content={<div data-testid="custom">Custom body</div>}
                onDismiss={vi.fn()}
                duration={0}
            />
        )
        expect(screen.getByTestId('custom')).toBeInTheDocument()
        expect(screen.queryByText('should-not-show')).not.toBeInTheDocument()
    })
})
