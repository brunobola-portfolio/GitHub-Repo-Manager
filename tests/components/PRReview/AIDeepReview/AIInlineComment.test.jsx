import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AIInlineComment } from '../../../../src/components/PRReview/AIDeepReview/AIInlineComment';

const baseComment = { line: 12, severity: 'warning', body: 'Use strict equality.', suggestion: 'a === b' };

describe('AIInlineComment', () => {
    it('renders severity, body, and the bot icon', () => {
        render(<AIInlineComment comment={baseComment} idx={0} onDismiss={() => {}} onEdit={() => {}} />);
        expect(screen.getByText(/use strict equality/i)).toBeInTheDocument();
        expect(screen.getByText(/warning/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/ai-generated comment/i)).toBeInTheDocument();
    });

    it('shows a suggestion preview when present', () => {
        render(<AIInlineComment comment={baseComment} idx={0} onDismiss={() => {}} onEdit={() => {}} />);
        expect(screen.getByText(/a === b/)).toBeInTheDocument();
    });

    it('Dismiss calls onDismiss(idx)', () => {
        const onDismiss = vi.fn();
        render(<AIInlineComment comment={baseComment} idx={3} onDismiss={onDismiss} onEdit={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
        expect(onDismiss).toHaveBeenCalledWith(3);
    });

    it('Edit toggles to an edit form and saves on submit', () => {
        const onEdit = vi.fn();
        render(<AIInlineComment comment={baseComment} idx={1} onDismiss={() => {}} onEdit={onEdit} />);
        fireEvent.click(screen.getByRole('button', { name: /edit/i }));
        const textarea = screen.getByLabelText(/comment body/i);
        fireEvent.change(textarea, { target: { value: 'new body' } });
        fireEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(onEdit).toHaveBeenCalledWith(1, expect.objectContaining({ body: 'new body' }));
    });
});
