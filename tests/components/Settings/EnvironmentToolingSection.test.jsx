// tests/components/Settings/EnvironmentToolingSection.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { EnvironmentToolingSection } from '../../../src/components/Settings/EnvironmentToolingSection.jsx';

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
});
