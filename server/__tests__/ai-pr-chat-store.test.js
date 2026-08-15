// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { initDB } = await vi.importActual('../db.js');
const { makeIntegrationDb } = await import('./helpers/integration-db.js');
const testDb = makeIntegrationDb(initDB);

vi.mock('../db.js', () => ({ default: testDb }));

const {
    appendMessage,
    listMessages,
    getMessagesTail,
    clearConversation,
} = await import('../lib/ai-pr-chat-store.js');

const USER_A = 1;
const USER_B = 2;

beforeEach(() => {
    testDb.prepare('DELETE FROM ai_pr_chat_messages').run();
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(USER_A, 'alice');
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(USER_B, 'bob');
});

describe('ai-pr-chat-store', () => {
    it('appendMessage inserts a row and returns the id', () => {
        const id = appendMessage(USER_A, 'acme', 'api', 42, { role: 'user', content: 'hi' });
        expect(id).toBeGreaterThan(0);

        const rows = listMessages(USER_A, 'acme', 'api', 42);
        expect(rows).toHaveLength(1);
        expect(rows[0].role).toBe('user');
        expect(rows[0].content).toBe('hi');
    });

    it('rejects unknown roles', () => {
        expect(() => appendMessage(USER_A, 'a', 'b', 1, { role: 'system', content: 'x' })).toThrow(/invalid role/i);
    });

    it('listMessages orders chronologically by id ASC', () => {
        appendMessage(USER_A, 'a', 'b', 1, { role: 'user', content: 'first' });
        appendMessage(USER_A, 'a', 'b', 1, { role: 'assistant', content: 'second' });
        appendMessage(USER_A, 'a', 'b', 1, { role: 'user', content: 'third' });
        const rows = listMessages(USER_A, 'a', 'b', 1);
        expect(rows.map((r) => r.content)).toEqual(['first', 'second', 'third']);
    });

    it('getMessagesTail returns only the most recent N (still ASC)', () => {
        for (let i = 0; i < 6; i++) {
            appendMessage(USER_A, 'a', 'b', 1, { role: 'user', content: `m${i}` });
        }
        const tail = getMessagesTail(USER_A, 'a', 'b', 1, 3);
        expect(tail.map((r) => r.content)).toEqual(['m3', 'm4', 'm5']);
    });

    it('persists tool message metadata as JSON', () => {
        appendMessage(USER_A, 'a', 'b', 1, {
            role: 'tool',
            content: 'file body',
            toolName: 'read_pr_file',
            toolInput: { path: 'src/x.js' },
            toolOutput: { ok: true },
        });
        const rows = listMessages(USER_A, 'a', 'b', 1);
        expect(rows[0].toolName).toBe('read_pr_file');
        expect(rows[0].toolInput).toEqual({ path: 'src/x.js' });
        expect(rows[0].toolOutput).toEqual({ ok: true });
    });

    it('isolates conversations per (user, repo, PR)', () => {
        appendMessage(USER_A, 'acme', 'api', 1, { role: 'user', content: 'A1' });
        appendMessage(USER_A, 'acme', 'api', 2, { role: 'user', content: 'A2' });
        appendMessage(USER_B, 'acme', 'api', 1, { role: 'user', content: 'B1' });

        expect(listMessages(USER_A, 'acme', 'api', 1).map((r) => r.content)).toEqual(['A1']);
        expect(listMessages(USER_A, 'acme', 'api', 2).map((r) => r.content)).toEqual(['A2']);
        expect(listMessages(USER_B, 'acme', 'api', 1).map((r) => r.content)).toEqual(['B1']);
    });

    it('clearConversation only removes rows for the same user/PR', () => {
        appendMessage(USER_A, 'acme', 'api', 1, { role: 'user', content: 'a' });
        appendMessage(USER_A, 'acme', 'api', 1, { role: 'assistant', content: 'b' });
        appendMessage(USER_B, 'acme', 'api', 1, { role: 'user', content: 'other' });

        const removed = clearConversation(USER_A, 'acme', 'api', 1);
        expect(removed).toBe(2);
        expect(listMessages(USER_A, 'acme', 'api', 1)).toHaveLength(0);
        expect(listMessages(USER_B, 'acme', 'api', 1)).toHaveLength(1);
    });
});
