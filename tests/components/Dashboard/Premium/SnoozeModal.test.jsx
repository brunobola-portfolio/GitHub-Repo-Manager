import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SnoozeModal } from '../../../../src/components/Dashboard/Premium/SnoozeModal';

describe('SnoozeModal', () => {
    it('returns ISO timestamp from preset selection', () => {
        const onConfirm = vi.fn();
        render(<SnoozeModal open onConfirm={onConfirm} onClose={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /1 hour/i }));
        expect(onConfirm).toHaveBeenCalledOnce();
        const arg = onConfirm.mock.calls[0][0];
        expect(typeof arg).toBe('string');
        expect(Date.parse(arg)).toBeGreaterThan(Date.now() + 50 * 60_000);
    });

    it('does not render when closed', () => {
        render(<SnoozeModal open={false} onConfirm={() => {}} onClose={() => {}} />);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
