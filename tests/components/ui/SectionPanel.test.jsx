import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Sparkles } from 'lucide-react'
import { SectionPanel } from '../../../src/components/ui/SectionPanel'

describe('SectionPanel', () => {
    it('renders the title as an h3', () => {
        render(<SectionPanel title="Pull Requests">body</SectionPanel>)
        const h = screen.getByRole('heading', { level: 3 })
        expect(h.textContent).toBe('Pull Requests')
    })

    it('renders eyebrow when supplied', () => {
        render(
            <SectionPanel eyebrow="Workspace" title="Pull Requests">
                body
            </SectionPanel>
        )
        expect(screen.getByText('Workspace')).toBeInTheDocument()
    })

    it('renders icon when supplied', () => {
        const { container } = render(
            <SectionPanel icon={Sparkles} title="Pull Requests">
                body
            </SectionPanel>
        )
        // lucide icons render as inline svg
        expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('renders an actions slot to the right', () => {
        render(
            <SectionPanel title="Pull Requests" actions={<button>Refresh</button>}>
                body
            </SectionPanel>
        )
        expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    })

    it('renders children inside the panel', () => {
        render(
            <SectionPanel title="Pull Requests">
                <span>Hello body</span>
            </SectionPanel>
        )
        expect(screen.getByText('Hello body')).toBeInTheDocument()
    })

    it('hides body content when collapsible + defaultOpen=false', () => {
        render(
            <SectionPanel title="Pull Requests" collapsible defaultOpen={false}>
                <span>secret-content</span>
            </SectionPanel>
        )
        expect(screen.queryByText('secret-content')).toBeNull()
    })

    it('toggles open/closed when collapsible chevron is clicked', () => {
        render(
            <SectionPanel title="Pull Requests" collapsible defaultOpen={false}>
                <span>secret-content</span>
            </SectionPanel>
        )
        const toggle = screen.getByRole('button', { name: /pull requests/i })
        expect(toggle).toHaveAttribute('aria-expanded', 'false')
        fireEvent.click(toggle)
        expect(toggle).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByText('secret-content')).toBeInTheDocument()
    })

    it('renders without header when no header props provided', () => {
        render(
            <SectionPanel>
                <span>headless body</span>
            </SectionPanel>
        )
        expect(screen.getByText('headless body')).toBeInTheDocument()
        // No heading rendered.
        expect(screen.queryByRole('heading')).toBeNull()
    })
})
