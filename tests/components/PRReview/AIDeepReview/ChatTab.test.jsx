import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatTab } from '../../../../src/components/PRReview/AIDeepReview/ChatTab';

beforeEach(() => {
    global.fetch = vi.fn();
    vi.stubEnv('VITE_MOCK_MODE', 'false');
});

afterEach(() => {
    vi.unstubAllEnvs();
});

function jsonResponse(status, body) {
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

describe('ChatTab', () => {
    it('renders an empty state when there is no history', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(200, { messages: [] }));
        render(<ChatTab owner="acme" repo="api" prNumber={42} />);

        await waitFor(() => {
            expect(screen.getByText(/Chat about PR #42/i)).toBeInTheDocument();
        });
        expect(screen.getByText(/Ask anything about PR #42/i)).toBeInTheDocument();
    });

    it('renders the persisted history', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(200, {
            messages: [
                { id: 1, role: 'user', content: 'hi' },
                { id: 2, role: 'assistant', content: 'hello back' },
            ],
        }));
        render(<ChatTab owner="acme" repo="api" prNumber={42} />);

        await waitFor(() => expect(screen.getByText('hi')).toBeInTheDocument());
        expect(screen.getByText(/hello back/i)).toBeInTheDocument();
    });

    it('disables Send button when input is empty', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(200, { messages: [] }));
        render(<ChatTab owner="acme" repo="api" prNumber={42} />);

        await waitFor(() => expect(screen.getByText(/Chat about PR #42/i)).toBeInTheDocument());
        const sendBtn = screen.getByRole('button', { name: /send/i });
        expect(sendBtn).toBeDisabled();
    });

    it('clicking Clear with no history is a no-op (button disabled)', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(200, { messages: [] }));
        render(<ChatTab owner="acme" repo="api" prNumber={42} />);

        await waitFor(() => expect(screen.getByText(/Chat about PR #42/i)).toBeInTheDocument());
        const clearBtn = screen.getByRole('button', { name: /clear conversation/i });
        expect(clearBtn).toBeDisabled();
    });

    it('shows the head SHA short form in the header when provided', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(200, { messages: [] }));
        render(<ChatTab owner="acme" repo="api" prNumber={42} headSha="abc1234567890" />);

        await waitFor(() => expect(screen.getByText(/abc1234/)).toBeInTheDocument());
    });

    it('typing a message enables the Send button', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(200, { messages: [] }));
        render(<ChatTab owner="acme" repo="api" prNumber={42} />);

        await waitFor(() => expect(screen.getByText(/Chat about PR #42/i)).toBeInTheDocument());

        const ta = screen.getByLabelText(/Chat message/i);
        fireEvent.change(ta, { target: { value: 'What changed?' } });
        const sendBtn = screen.getByRole('button', { name: /send/i });
        expect(sendBtn).not.toBeDisabled();
    });
});
