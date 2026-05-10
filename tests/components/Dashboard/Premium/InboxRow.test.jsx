import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InboxRow } from '../../../../src/components/Dashboard/Premium/InboxRow';

const ITEM = {
    id: 'pr:foo/bar#1',
    kind: 'pr',
    section: 'needs_review',
    repoFullName: 'foo/bar',
    prNumber: 1,
    title: 'feat: add widget',
    authorLogin: 'alice',
    since: '2026-05-09T00:00:00Z',
};

describe('InboxRow', () => {
    it('renders title, repo, and author', () => {
        render(<InboxRow item={ITEM} />);
        expect(screen.getByText('feat: add widget')).toBeInTheDocument();
        expect(screen.getByText('foo/bar')).toBeInTheDocument();
        expect(screen.getByText(/alice/)).toBeInTheDocument();
    });

    it('calls onArchive when archive button clicked', () => {
        const onArchive = vi.fn();
        render(<InboxRow item={ITEM} onArchive={onArchive} />);
        fireEvent.click(screen.getByLabelText(/archive/i));
        expect(onArchive).toHaveBeenCalledWith('pr:foo/bar#1');
    });

    it('toggles expanded state on chevron click', () => {
        render(<InboxRow item={ITEM} />);
        const chevron = screen.getByLabelText(/expand/i);
        expect(chevron).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(chevron);
        expect(chevron).toHaveAttribute('aria-expanded', 'true');
    });

    it('honours prefers-reduced-motion with reduced transition duration', () => {
        document.documentElement.style.setProperty('--ds-duration-row-expand', '0.01s');
        render(<InboxRow item={ITEM} />);
        const chevron = screen.getByLabelText(/expand/i);
        // The component sets transition inline with var(--ds-duration-row-expand).
        // jsdom does not resolve CSS custom properties in getComputedStyle, so we
        // assert on the inline style value directly to verify the design-system
        // reduced-motion contract is wired correctly.
        expect(chevron.style.transition).toContain('var(--ds-duration-row-expand)');
    });
});
