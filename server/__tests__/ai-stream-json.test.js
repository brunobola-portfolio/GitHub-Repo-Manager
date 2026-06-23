// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { extractReplyText } from '../lib/ai-features/stream-json.js';

describe('extractReplyText — progressive reply extraction from partial JSON', () => {
    it('returns empty string before the reply key has streamed in', () => {
        expect(extractReplyText('')).toBe('');
        expect(extractReplyText('{"act')).toBe('');
        expect(extractReplyText('{"actions":[],')).toBe('');
    });

    it('extracts the reply value while it is still streaming (no closing quote yet)', () => {
        expect(extractReplyText('{"reply":"Hello wo')).toBe('Hello wo');
    });

    it('extracts the full reply once the value is closed', () => {
        expect(extractReplyText('{"reply":"Hello world","actions":[]}')).toBe('Hello world');
    });

    it('strips a leading ```json code fence the model sometimes emits', () => {
        expect(extractReplyText('```json\n{"reply":"Hi there"}')).toBe('Hi there');
        expect(extractReplyText('```\n{"reply":"Hi"}')).toBe('Hi');
    });

    it('tolerates whitespace around the key and colon', () => {
        expect(extractReplyText('{ "reply" : "spaced"')).toBe('spaced');
    });

    it('decodes JSON escape sequences (newline, tab, quote, backslash)', () => {
        expect(extractReplyText('{"reply":"line1\\nline2"}')).toBe('line1\nline2');
        expect(extractReplyText('{"reply":"He said \\"hi\\""}')).toBe('He said "hi"');
        expect(extractReplyText('{"reply":"a\\\\b"}')).toBe('a\\b');
    });

    it('decodes a complete \\uXXXX escape', () => {
        expect(extractReplyText('{"reply":"caf\\u00e9"}')).toBe('café');
    });

    it('drops a trailing incomplete escape at the streaming boundary', () => {
        // chunk ends mid-escape — don’t emit a stray backslash
        expect(extractReplyText('{"reply":"abc\\')).toBe('abc');
        // incomplete unicode escape
        expect(extractReplyText('{"reply":"x\\u00')).toBe('x');
    });

    it('does not read past the closing quote into actions', () => {
        expect(extractReplyText('{"reply":"done","actions":[{"type":"x","label":"y"}]}')).toBe('done');
    });

    it('finds the reply key even when another key precedes it', () => {
        expect(extractReplyText('{"foo":1,"reply":"after"')).toBe('after');
    });
});
