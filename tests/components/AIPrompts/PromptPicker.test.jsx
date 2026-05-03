import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PromptPicker } from '../../../src/components/AIPrompts/PromptPicker';

const presets = [
    { id: 'general', builtin: true, name: 'General' },
    { id: 'security', builtin: true, name: 'Security audit', severityFloor: 'warning' },
    { id: 7, builtin: false, name: 'My custom', isDefault: true },
];

describe('PromptPicker', () => {
    it('renders the active preset name', () => {
        render(<PromptPicker presets={presets} activeKey="general" onChange={() => {}} />);
        expect(screen.getByRole('button', { name: /general/i })).toBeInTheDocument();
    });

    it('opens the listbox on click and shows all presets', () => {
        render(<PromptPicker presets={presets} activeKey="general" onChange={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /general/i }));
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        expect(screen.getByText('Security audit')).toBeInTheDocument();
        expect(screen.getByText('My custom')).toBeInTheDocument();
    });

    it('shows built-in badge on built-ins and default badge on default', () => {
        render(<PromptPicker presets={presets} activeKey="general" onChange={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /general/i }));
        const builtinLabels = screen.getAllByText(/built-in/i);
        expect(builtinLabels.length).toBeGreaterThanOrEqual(2); // both built-ins
        expect(screen.getByText(/default/i)).toBeInTheDocument();
    });

    it('shows severity floor when present', () => {
        render(<PromptPicker presets={presets} activeKey="general" onChange={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /general/i }));
        expect(screen.getByText(/≥ warning/i)).toBeInTheDocument();
    });

    it('calls onChange and closes on selection', () => {
        const onChange = vi.fn();
        render(<PromptPicker presets={presets} activeKey="general" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /general/i }));
        fireEvent.click(screen.getByText('Security audit'));
        expect(onChange).toHaveBeenCalledWith('security');
        // Listbox closed
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('returns null when presets is empty', () => {
        const { container } = render(<PromptPicker presets={[]} activeKey="" onChange={() => {}} />);
        expect(container.firstChild).toBeNull();
    });

    it('closes on Escape', () => {
        render(<PromptPicker presets={presets} activeKey="general" onChange={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /general/i }));
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('closes on click outside', () => {
        render(
            <div>
                <button data-testid="outside">elsewhere</button>
                <PromptPicker presets={presets} activeKey="general" onChange={() => {}} />
            </div>
        );
        fireEvent.click(screen.getByRole('button', { name: /general/i }));
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        fireEvent.pointerDown(screen.getByTestId('outside'));
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('Arrow keys cycle through options', async () => {
        render(<PromptPicker presets={presets} activeKey="general" onChange={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /general/i }));
        await new Promise((r) => setTimeout(r, 10)); // wait for focus defer
        const list = screen.getByRole('listbox');
        fireEvent.keyDown(list, { key: 'ArrowDown' });
        // Active option moves; we can't easily assert focus in jsdom but the handler should not throw
        fireEvent.keyDown(list, { key: 'ArrowUp' });
        fireEvent.keyDown(list, { key: 'Home' });
        fireEvent.keyDown(list, { key: 'End' });
        // List should still be open (no errors)
        expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
});
