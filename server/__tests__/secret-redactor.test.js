import { describe, it, expect } from 'vitest';
import { redact, SECRET_REGEX } from '../lib/secret-redactor.js';

describe('redact', () => {
    it('returns content unchanged when no secrets present', () => {
        const out = redact('line one\nline two\n');
        expect(out.content).toBe('line one\nline two\n');
        expect(out.count).toBe(0);
    });

    it('redacts a line containing api_key', () => {
        const out = redact('foo\napi_key=abc123\nbar');
        expect(out.content).toBe('foo\n[REDACTED — possible secret]\nbar');
        expect(out.count).toBe(1);
    });

    it('redacts ghp_ classic tokens', () => {
        const long = 'a'.repeat(36);
        const out = redact(`x: ghp_${long}`);
        expect(out.content).toBe('[REDACTED — possible secret]');
        expect(out.count).toBe(1);
    });

    it('redacts sk- secret tokens', () => {
        const out = redact('OPENAI=sk-abcdefghijklmnopqrstuvwx');
        expect(out.count).toBe(1);
    });

    it('redacts Slack xoxb tokens', () => {
        const out = redact('SLACK=xoxb-1234567890');
        expect(out.count).toBe(1);
    });

    it('redacts bearer tokens', () => {
        const out = redact('Authorization: bearer abc.def.ghi');
        expect(out.count).toBe(1);
    });

    it('counts each redacted line once even with multiple matches on the same line', () => {
        const out = redact('api_key=1 secret=2 token=3');
        expect(out.count).toBe(1);
    });

    it('handles empty / non-string input', () => {
        expect(redact('')).toEqual({ content: '', count: 0 });
        expect(redact(null)).toEqual({ content: '', count: 0 });
    });

    it('preserves line endings (LF)', () => {
        const out = redact('a\nb\nc');
        expect(out.content).toBe('a\nb\nc');
    });

    it('exports SECRET_REGEX for inspection', () => {
        expect(SECRET_REGEX).toBeInstanceOf(RegExp);
    });
});
