import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

const mockHook = { repos: [] }
vi.mock('../../../src/hooks/useTrackedRepos', () => ({
    useTrackedRepos: () => mockHook,
}))

const { TrackedDot } = await import('../../../src/components/WorkBoard/TrackedDot')

describe('TrackedDot', () => {
    it('renders nothing when repo is not tracked', () => {
        mockHook.repos = []
        const { container } = render(<TrackedDot repoFullName="acme/x" />)
        expect(container.firstChild).toBeNull()
    })

    it('renders an indigo filled dot when repo is tracked and not muted', () => {
        mockHook.repos = [{ repo_full_name: 'acme/x', is_pinned: 0, is_muted: 0 }]
        const { container } = render(<TrackedDot repoFullName="acme/x" />)
        const dot = container.firstChild
        expect(dot).not.toBeNull()
        expect(dot.getAttribute('data-state')).toBe('active')
    })

    it('renders a hollow dot when repo is muted', () => {
        mockHook.repos = [{ repo_full_name: 'acme/x', is_pinned: 0, is_muted: 1 }]
        const { container } = render(<TrackedDot repoFullName="acme/x" />)
        expect(container.firstChild.getAttribute('data-state')).toBe('muted')
    })

    it('pinned repos also render the indigo filled dot', () => {
        mockHook.repos = [{ repo_full_name: 'acme/x', is_pinned: 1, is_muted: 0 }]
        const { container } = render(<TrackedDot repoFullName="acme/x" />)
        expect(container.firstChild.getAttribute('data-state')).toBe('active')
    })

    it('has a descriptive aria-label matching the state', () => {
        mockHook.repos = [{ repo_full_name: 'acme/x', is_pinned: 0, is_muted: 0 }]
        const { container } = render(<TrackedDot repoFullName="acme/x" />)
        expect(container.firstChild.getAttribute('aria-label')).toMatch(/tracked/i)
    })
})
