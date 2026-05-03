import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useFocusTrap } from '../../src/hooks/useFocusTrap';

function TestComponent({ active, onClose = () => {} }) {
    const ref = useFocusTrap(active, onClose);
    return (
        <div>
            <button data-testid="outside">outside</button>
            {active ? (
                <div ref={ref} data-testid="container">
                    <button data-testid="first">first</button>
                    <button data-testid="middle">middle</button>
                    <button data-testid="last">last</button>
                </div>
            ) : null}
        </div>
    );
}

describe('useFocusTrap', () => {
    it('focuses the first focusable on activate', async () => {
        const { getByTestId } = render(<TestComponent active />);
        // hook defers focus by 50ms
        await new Promise((r) => setTimeout(r, 80));
        expect(document.activeElement).toBe(getByTestId('first'));
    });

    // jsdom doesn't compute layout, so getFocusables() in useFocusTrap relies
    // on querySelectorAll which works fine here. Tab cycling exercises the
    // keydown path attached to document.
    it('Tab from last cycles to first', async () => {
        const { getByTestId } = render(<TestComponent active />);
        await new Promise((r) => setTimeout(r, 80));
        const last = getByTestId('last');
        last.focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(document.activeElement).toBe(getByTestId('first'));
    });

    it('Shift+Tab from first cycles to last', async () => {
        const { getByTestId } = render(<TestComponent active />);
        await new Promise((r) => setTimeout(r, 80));
        const first = getByTestId('first');
        first.focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(getByTestId('last'));
    });

    it('inactive: does not steal focus', async () => {
        const { getByTestId } = render(<TestComponent active={false} />);
        const outside = getByTestId('outside');
        outside.focus();
        await new Promise((r) => setTimeout(r, 80));
        expect(document.activeElement).toBe(outside);
    });

    it('Escape key calls onClose', async () => {
        const onClose = vi.fn();
        render(<TestComponent active onClose={onClose} />);
        await new Promise((r) => setTimeout(r, 80));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
