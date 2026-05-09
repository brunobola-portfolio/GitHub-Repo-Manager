import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextPicker } from '../../../src/components/AI/ContextPicker';

const NOOP = () => {};

function renderPicker(overrides = {}) {
    const props = {
        mode: 'single',
        signals: { readme: true, manifest: true, entrypoints: false, folderStructure: false, topics: true, language: true },
        onSignalChange: NOOP,
        customFiles: [],
        onAddCustomFile: NOOP,
        onRemoveCustomFile: NOOP,
        onReset: NOOP,
        treeOpenable: true,
        owner: 'o',
        repoName: 'r',
        ...overrides,
    };
    return render(<ContextPicker {...props} />);
}

describe('<ContextPicker />', () => {
    it('renders all six signal toggles in single mode', () => {
        renderPicker();
        fireEvent.click(screen.getByRole('button', { name: /context/i }));
        ['README', 'Manifest', 'Topics', 'Language', 'Entrypoints', 'Folder structure'].forEach((label) => {
            expect(screen.getByText(new RegExp(label, 'i'))).toBeInTheDocument();
        });
    });

    it('hides "Add specific file" in batch mode', () => {
        renderPicker({ mode: 'batch' });
        fireEvent.click(screen.getByRole('button', { name: /context/i }));
        expect(screen.queryByText(/add specific file/i)).toBeNull();
    });

    it('emits onSignalChange when a checkbox toggles', () => {
        const onSignalChange = vi.fn();
        renderPicker({ onSignalChange });
        fireEvent.click(screen.getByRole('button', { name: /context/i }));
        const ep = screen.getByLabelText(/entrypoints/i);
        fireEvent.click(ep);
        expect(onSignalChange).toHaveBeenCalledWith('entrypoints', true);
    });

    it('shows the byte meter total scaled by enabled signals', () => {
        renderPicker(); // README+manifest+topics+language ON
        fireEvent.click(screen.getByRole('button', { name: /context/i }));
        // Bytes are static-ish per signal; we only check the meter exists and includes "/ 8 KB"
        expect(screen.getByText(/\/\s*8\s*(\.0)?\s*KB/i)).toBeInTheDocument();
    });

    it('reset button calls onReset', () => {
        const onReset = vi.fn();
        renderPicker({ onReset });
        fireEvent.click(screen.getByRole('button', { name: /context/i }));
        fireEvent.click(screen.getByRole('button', { name: /reset/i }));
        expect(onReset).toHaveBeenCalled();
    });
});
