// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
    buildSystemPrompt,
    compactHistory,
    renderHistoryAsPrompt,
    MAX_HISTORY_TURNS,
} from '../../lib/ai-features/pr-chat.js';

describe('pr-chat / buildSystemPrompt', () => {
    it('embeds repo, PR number, title, author and body', () => {
        const prompt = buildSystemPrompt({
            repoFullName: 'acme/api',
            prMetadata: { number: 42, title: 'Add OAuth refresh', author: 'alice', body: 'Refresh tokens' },
        });
        expect(prompt).toContain('acme/api');
        expect(prompt).toContain('#42');
        expect(prompt).toContain('Add OAuth refresh');
        expect(prompt).toContain('alice');
        expect(prompt).toContain('Refresh tokens');
    });

    it('uses (no description) placeholder when body is missing', () => {
        const prompt = buildSystemPrompt({
            repoFullName: 'a/b',
            prMetadata: { number: 1, title: 't', author: 'u' },
        });
        expect(prompt).toContain('(no description)');
    });

    it('embeds the walkthrough when provided', () => {
        const prompt = buildSystemPrompt({
            repoFullName: 'a/b',
            prMetadata: { number: 1, title: 't', author: 'u' },
            walkthrough: 'This PR refactors auth.',
        });
        expect(prompt).toContain('Prior AI walkthrough');
        expect(prompt).toContain('This PR refactors auth.');
    });

    it('renders a file manifest with status + line counts', () => {
        const prompt = buildSystemPrompt({
            repoFullName: 'a/b',
            prMetadata: { number: 1, title: 't', author: 'u' },
            fileManifest: [
                { filename: 'src/auth.js', status: 'modified', additions: 5, deletions: 1 },
                { filename: 'README.md', status: 'added', additions: 10, deletions: 0 },
            ],
        });
        expect(prompt).toMatch(/Changed files \(2\)/);
        expect(prompt).toContain('src/auth.js');
        expect(prompt).toContain('README.md');
        expect(prompt).toContain('+5/-1');
    });

    it('truncates very long bodies via sanitizeForPrompt', () => {
        const huge = 'x'.repeat(10_000);
        const prompt = buildSystemPrompt({
            repoFullName: 'a/b',
            prMetadata: { number: 1, title: 't', author: 'u', body: huge },
        });
        // Body is capped at 800 in buildSystemPrompt; the prompt itself
        // shouldn't blow up.
        expect(prompt.length).toBeLessThan(huge.length);
    });
});

describe('pr-chat / compactHistory', () => {
    it('returns the input unchanged when under the cap', () => {
        const msgs = [
            { role: 'user', content: 'a' },
            { role: 'assistant', content: 'b' },
        ];
        expect(compactHistory(msgs, 5)).toEqual(msgs);
    });

    it('drops oldest messages when over the cap and prepends a placeholder', () => {
        const msgs = [];
        for (let i = 0; i < 30; i++) msgs.push({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` });
        const out = compactHistory(msgs, 5); // keep last 10
        expect(out.length).toBeLessThan(msgs.length);
        expect(out[0].content).toMatch(/earlier messages omitted/);
        // The most recent message survives intact.
        expect(out[out.length - 1].content).toBe('m29');
    });

    it('uses MAX_HISTORY_TURNS as default cap', () => {
        const msgs = Array.from({ length: 50 }, (_, i) => ({ role: 'user', content: String(i) }));
        const out = compactHistory(msgs);
        expect(out.length).toBe(MAX_HISTORY_TURNS * 2 + 1); // +1 for placeholder
    });

    it('handles non-array input gracefully', () => {
        expect(compactHistory(null)).toEqual([]);
        expect(compactHistory(undefined)).toEqual([]);
    });
});

describe('pr-chat / renderHistoryAsPrompt', () => {
    it('formats user/assistant/tool rows with role prefixes', () => {
        const out = renderHistoryAsPrompt([
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' },
            { role: 'tool', toolName: 'read_pr_file', content: 'file body' },
        ]);
        expect(out).toContain('User: hi');
        expect(out).toContain('Assistant: hello');
        expect(out).toContain('Tool(read_pr_file): file body');
    });

    it('returns an empty string for empty history', () => {
        expect(renderHistoryAsPrompt([])).toBe('');
        expect(renderHistoryAsPrompt(null)).toBe('');
    });
});
