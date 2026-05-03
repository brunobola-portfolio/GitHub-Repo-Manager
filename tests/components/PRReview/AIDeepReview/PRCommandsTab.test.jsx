import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PRCommandsTab } from '../../../../src/components/PRReview/AIDeepReview/PRCommandsTab';

beforeEach(() => {
    global.fetch = vi.fn();
    // .env.test pins VITE_MOCK_MODE=true. Disable so the hook hits real fetch().
    vi.stubEnv('VITE_MOCK_MODE', 'false');
});

afterEach(() => {
    vi.unstubAllEnvs();
});

function jsonResponse(status, body) {
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

describe('PRCommandsTab', () => {
    it('renders all three command cards with empty state when nothing is cached', async () => {
        // Three GET calls — one per command — all 404.
        global.fetch.mockImplementation(() => jsonResponse(404, { code: 'NOT_FOUND' }));
        render(<PRCommandsTab owner="acme" repo="api" prNumber={42} />);

        // Each command card surfaces its label
        expect(screen.getByText('/describe')).toBeInTheDocument();
        expect(screen.getByText('/test_plan')).toBeInTheDocument();
        expect(screen.getByText('/improve')).toBeInTheDocument();

        // Empty state appears once cached lookups settle.
        await waitFor(() => {
            const empties = screen.getAllByText(/No result yet/i);
            expect(empties.length).toBeGreaterThanOrEqual(3);
        });
    });

    it('renders a describe result when cached and shows the Apply to PR button', async () => {
        // describe: 200 with body. test_plan + improve: 404 (order doesn't matter).
        const cachedDescribe = { id: 1, command: 'describe', output: { title: 'T', body: '## Hello\n\nWorld' } };
        const responses = new Map([
            ['describe', jsonResponse(200, cachedDescribe)],
        ]);
        global.fetch.mockImplementation((url) => {
            if (url.endsWith('/describe')) return responses.get('describe');
            return jsonResponse(404, { code: 'NOT_FOUND' });
        });

        render(<PRCommandsTab owner="acme" repo="api" prNumber={42} />);

        await waitFor(() => {
            expect(screen.getByText(/Suggested title/i)).toBeInTheDocument();
        });
        expect(screen.getByRole('heading', { level: 2, name: /Hello/i })).toBeInTheDocument();
        // Apply-to-PR button only renders for /describe
        expect(screen.getByRole('button', { name: /Apply to PR/i })).toBeInTheDocument();
    });

    it('clicking Run on a fresh card calls the POST endpoint', async () => {
        // All 3 GETs return 404 first.
        global.fetch.mockImplementation(() => jsonResponse(404, {}));
        render(<PRCommandsTab owner="acme" repo="api" prNumber={42} />);

        await waitFor(() => {
            expect(screen.getAllByRole('button', { name: /^Run$/ }).length).toBe(3);
        });

        // First Run button is for /describe (deterministic by render order).
        const generated = { id: 9, command: 'describe', output: { body: '## Generated' } };
        global.fetch.mockReturnValueOnce(jsonResponse(200, generated));

        const runButtons = screen.getAllByRole('button', { name: /^Run$/ });
        fireEvent.click(runButtons[0]);

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                '/api/ai/pr-commands/acme/api/42/describe',
                expect.objectContaining({ method: 'POST' }),
            );
        });
    });
});
