import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileTreePicker } from '../../../src/components/AI/FileTreePicker';

vi.mock('../../../src/api/repos', () => ({
    reposApi: {
        getTree: vi.fn(),
    },
}));

import { reposApi } from '../../../src/api/repos';

beforeEach(() => reposApi.getTree.mockReset());

describe('<FileTreePicker />', () => {
    it('lists fetched blob entries', async () => {
        reposApi.getTree.mockResolvedValue({
            branch: 'main', truncated: false,
            entries: [
                { path: 'README.md', type: 'blob', size: 100 },
                { path: 'src/index.js', type: 'blob', size: 200 },
            ],
        });
        render(<FileTreePicker isOpen owner="o" repoName="r" branch="main" onPick={() => {}} onClose={() => {}} />);
        await waitFor(() => expect(screen.getByText('README.md')).toBeInTheDocument());
        expect(screen.getByText('src/index.js')).toBeInTheDocument();
    });

    it('filters entries by search', async () => {
        reposApi.getTree.mockResolvedValue({
            branch: 'main', truncated: false,
            entries: [
                { path: 'README.md', type: 'blob', size: 100 },
                { path: 'src/index.js', type: 'blob', size: 200 },
            ],
        });
        render(<FileTreePicker isOpen owner="o" repoName="r" branch="main" onPick={() => {}} onClose={() => {}} />);
        await waitFor(() => screen.getByText('README.md'));
        fireEvent.change(screen.getByPlaceholderText(/search files/i), { target: { value: 'index' } });
        expect(screen.queryByText('README.md')).toBeNull();
        expect(screen.getByText('src/index.js')).toBeInTheDocument();
    });

    it('calls onPick with the selected entry', async () => {
        reposApi.getTree.mockResolvedValue({
            branch: 'main', truncated: false,
            entries: [{ path: 'README.md', type: 'blob', size: 100 }],
        });
        const onPick = vi.fn();
        render(<FileTreePicker isOpen owner="o" repoName="r" branch="main" onPick={onPick} onClose={() => {}} />);
        await waitFor(() => screen.getByText('README.md'));
        fireEvent.click(screen.getByText('README.md'));
        expect(onPick).toHaveBeenCalledWith({ path: 'README.md', size: 100 });
    });

    it('shows truncated banner when response is truncated', async () => {
        reposApi.getTree.mockResolvedValue({ branch: 'main', truncated: true, entries: [] });
        render(<FileTreePicker isOpen owner="o" repoName="r" branch="main" onPick={() => {}} onClose={() => {}} />);
        await waitFor(() => expect(screen.getByText(/use search/i)).toBeInTheDocument());
    });

    it('renders error state on fetch failure', async () => {
        reposApi.getTree.mockRejectedValueOnce(new Error('boom'));
        render(<FileTreePicker isOpen owner="o" repoName="r" branch="main" onPick={() => {}} onClose={() => {}} />);
        await waitFor(() => expect(screen.getByText(/could not load/i)).toBeInTheDocument());
    });
});
