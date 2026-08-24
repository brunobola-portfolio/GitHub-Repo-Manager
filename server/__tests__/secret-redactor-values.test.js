// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.
/*
 * Value-shaped redaction for diffs bound to AI providers.
 *
 * The line-kill redactor is right for repository context and wrong for pull
 * request diffs: a PR that touches auth code says "token" and "password" on
 * half its meaningful lines, and a reviewer model reading [REDACTED] × 40
 * reviews nothing. redactValues keeps the line and replaces only the
 * credential-shaped value — so BOTH properties need tests: secrets go, and
 * ordinary auth code survives.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { redactValues } from '../lib/secret-redactor.js';

describe('credential-shaped values are replaced', () => {
    // [name, full line, the exact secret that must not survive]
    it.each([
        ['github classic', `token = "ghp_${'a'.repeat(36)}"`, `ghp_${'a'.repeat(36)}`],
        ['github fine-grained', `t = "github_pat_${'b'.repeat(30)}"`, `github_pat_${'b'.repeat(30)}`],
        ['openai', `key: 'sk-proj-${'x'.repeat(28)}'`, `sk-proj-${'x'.repeat(28)}`],
        ['anthropic', `key: 'sk-ant-${'y'.repeat(28)}'`, `sk-ant-${'y'.repeat(28)}`],
        // Assembled at runtime: a literal xoxb-… string trips GitHub push
        // protection (rightly — a scanner cannot know a fixture from a leak).
        ['slack', `SLACK=xoxb-${'123456789012'}-abcdefghijklmno`, 'xoxb-123456789012-abcdefghijk'.slice(0, 20)],
        ['stripe', `stripe = "sk_live_${'z'.repeat(24)}"`, `sk_live_${'z'.repeat(24)}`],
        ['aws key id', 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
        ['google', `g = "AIza${'D'.repeat(35)}"`, `AIza${'D'.repeat(35)}`],
        ['jwt', 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMiJ9.SflKxwRJSMeKKF2QT4fw', 'eyJhbGciOiJIUzI1NiJ9'],
        ['json client_secret', '"client_secret": "abcd1234efgh5678"', 'abcd1234efgh5678'],
        ['env password', 'password="hunter2hunter2"', 'hunter2hunter2'],
    ])('%s', (_name, line, secret) => {
        const { content, count } = redactValues(line);
        expect(count).toBeGreaterThan(0);
        expect(content).toContain('[REDACTED:');
        expect(content).not.toContain(secret);
    });

    it('removes a PEM block wholesale, including an unterminated one', () => {
        const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\nMIIEowIBAAKCAQEB';
        const { content, count } = redactValues(`prefix\n${pem}`);
        expect(count).toBe(1);
        expect(content).not.toContain('MIIEow');
        expect(content).toContain('prefix');
    });
});

describe('ordinary auth code survives untouched', () => {
    it.each([
        'const token = req.headers.authorization',
        "if (!password || password.length < 8) throw new Error('too short')",
        'token: process.env.MY_TOKEN',
        'const [token, setToken] = useState(null)',
        "secretName = 'user.profile'",
        "const url = `${base}/api/token/refresh`",
        'password_confirmation === password',
        "apiKeyId = row.id // integer, not the key",
    ])('%s', (line) => {
        const { content, count } = redactValues(line);
        expect(count).toBe(0);
        expect(content).toBe(line);
    });

    it('keeps every line of a realistic auth diff — no line-kill regressions', () => {
        const diff = [
            '--- server/middleware/api-key-auth.js',
            '+function hashKey(key) {',
            "+    return createHmac('sha256', config.apiKeySecret).update(key).digest('hex')",
            '+}',
            "+const token = header.slice('Bearer '.length)",
            '+if (!token || revoked) return res.status(401).json({ error: PUBLIC_401 })',
        ].join('\n');
        const { content, count } = redactValues(diff);
        expect(count).toBe(0);
        expect(content).toBe(diff);
    });
});

describe('the three diff entry points run the redactor', () => {
    // Wiring, not behaviour: each route builds its provider-bound patch text
    // through redactValues. If a refactor drops one, the diff goes out raw
    // and nothing else in the suite notices.
    it.each([
        ['server/routes/ai/deep-review.js', /redactValues\(rawDiffPatch\)/],
        ['server/routes/ai/pr-commands.js', /redactValues\(rawDiffPatch\)/],
        ['server/routes/ai/dev-toolkit.js', /redactValues\(f\.patch\)/],
    ])('%s', (file, pattern) => {
        const src = readFileSync(file, 'utf8');
        expect(src).toMatch(/from '\.\.\/\.\.\/lib\/secret-redactor\.js'/);
        expect(src).toMatch(pattern);
    });
});
