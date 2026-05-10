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
});
