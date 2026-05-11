import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InboxSection } from '../../../../src/components/Dashboard/Premium/InboxSection';

describe('InboxSection', () => {
    it('shows label and count', () => {
        render(<InboxSection label="Needs my review" count={3} active={false} onClick={() => {}} />);
        expect(screen.getByText('Needs my review')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('renders the active state with full opacity', () => {
        render(<InboxSection label="Mentions" count={1} active onClick={() => {}} />);
        const btn = screen.getByRole('button');
        expect(btn.getAttribute('aria-current')).toBe('true');
    });

    it('fires onClick', () => {
        const onClick = vi.fn();
        render(<InboxSection label="Mentions" count={1} active={false} onClick={onClick} />);
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('omits aria-current when not active', () => {
        render(<InboxSection label="x" count={0} active={false} onClick={() => {}} />);
        expect(screen.getByRole('button').getAttribute('aria-current')).toBeNull();
    });
});
