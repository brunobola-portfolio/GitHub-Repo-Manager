// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { sanitizeOutput } from '../../lib/env/sanitize.js';

describe('sanitizeOutput', () => {
  it('masks userinfo in URLs but preserves host and path', () => {
    expect(sanitizeOutput('http://user:pass@host/path')).toBe('http://***@host/path');
  });

  it('preserves a clean GitHub URL with no credentials', () => {
    const url = 'https://github.com/git-for-windows/git/releases';
    expect(sanitizeOutput(url)).toBe(url);
  });

  it('masks an Authorization Bearer header', () => {
    expect(sanitizeOutput('Authorization: Bearer abc.def.ghi')).toBe('Authorization: Bearer ***');
  });

  it('masks a realistic mixed-class token (ghp_ prefix + 36 chars)', () => {
    // ghp_ + 36 mixed letters+digits = 40 chars total, has both letters and digits
    const token = 'ghp_' + 'aB3dEf7hIj2kLm9nOp1qRs4tUv6wXy8zA5b';
    expect(sanitizeOutput(token)).toBe('***');
  });

  it('preserves a 40-char all-lowercase path-like run', () => {
    // all-lowercase = no digits, so entropy heuristic skips it
    const segment = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmn';
    expect(sanitizeOutput(segment)).toBe(segment);
  });

  it('returns empty string for falsy input', () => {
    expect(sanitizeOutput('')).toBe('');
    expect(sanitizeOutput(null)).toBe('');
    expect(sanitizeOutput(undefined)).toBe('');
    expect(sanitizeOutput(0)).toBe('');
  });
});
