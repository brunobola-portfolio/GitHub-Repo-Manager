// tests/components/Settings/EnvironmentToolingSection.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { EnvironmentToolingSection } from '../../../src/components/Settings/EnvironmentToolingSection.jsx';
import { apiCall } from '../../../src/utils/api';

vi.mock('../../../src/utils/api', () => ({
  apiCall: vi.fn().mockResolvedValue({
    platform: 'linux',
    managers: { available: ['apt'], preferred: 'apt' },
    readiness: { ok: false },
    tools: [
      { id: 'git', label: 'Git', status: 'ok', version: '2.45.1' },
      { id: 'git-lfs', label: 'Git LFS', status: 'missing', version: null },
    ],
  }),
}));
vi.mock('../../../src/hooks/useToast', () => ({ useToast: () => ({ toast: { success: vi.fn(), errorFromException: vi.fn() } }) }));

describe('EnvironmentToolingSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a row per tool with status', async () => {
    render(<EnvironmentToolingSection isAdmin />);
    await waitFor(() => expect(screen.getByText('Git LFS')).toBeInTheDocument());
    expect(screen.getByText('2.45.1')).toBeInTheDocument();
    expect(screen.getByText(/missing/i)).toBeInTheDocument();
  });

  it('shows the admin-only empty state for non-admins', async () => {
    render(<EnvironmentToolingSection isAdmin={false} />);
    await waitFor(() => expect(screen.getByText(/admin only/i)).toBeInTheDocument());
  });

  it('renders Install button for missing tool when package manager is preferred', async () => {
    render(<EnvironmentToolingSection isAdmin />);
    await waitFor(() => expect(screen.getByText('Git LFS')).toBeInTheDocument());
    const installButton = await screen.findByRole('button', { name: /install/i });
    expect(installButton).toBeInTheDocument();
  });

  it('renders only one Install button for the missing tool, not for ok tool', async () => {
    render(<EnvironmentToolingSection isAdmin />);
    await waitFor(() => expect(screen.getByText('Git LFS')).toBeInTheDocument());
    const installButtons = screen.getAllByRole('button', { name: /install/i });
    expect(installButtons).toHaveLength(1);
  });

  it('does not render Install button when package manager preferred is null', async () => {
    apiCall.mockResolvedValueOnce({
      platform: 'linux',
      managers: { available: [], preferred: null },
      readiness: { ok: false },
      tools: [
        { id: 'git', label: 'Git', status: 'ok', version: '2.45.1' },
        { id: 'git-lfs', label: 'Git LFS', status: 'missing', version: null },
      ],
    });
    render(<EnvironmentToolingSection isAdmin />);
    await waitFor(() => expect(screen.getByText('Git LFS')).toBeInTheDocument());
    const installButton = screen.queryByRole('button', { name: /install/i });
    expect(installButton).not.toBeInTheDocument();
  });
});
