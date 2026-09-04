// SPDX-License-Identifier: Apache-2.0
/*
 * B-12 — the operator-facing env vars newly validated by server/config.js's
 * zod schema must be documented in BOTH .env.example (so a self-hoster's
 * copied template mentions them) and docs/operations.md (so the reference
 * table explains what they do). Before this pass, several existed in
 * .env.example but not docs/operations.md, and ALLOW_MOCK_AUTH existed in
 * neither — an operator had no way to discover it short of reading the
 * source. This is a ratchet on that specific class of drift, not a claim
 * that every config.js field needs a docs entry (many are self-explanatory
 * Stripe/OAuth credentials already covered by their own setup sections).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The B-12 set: 14 vars moved into config.js's schema this pass, plus the
// two boolean toggles that motivated the pattern (already schema-adjacent
// via post-parse assignment) — all newly required to appear in both files.
const TRACKED_VARS = [
    'WORK_BOARD_AI_ENABLED',
    'ALLOW_MOCK_AUTH',
    'METRICS_TOKEN',
    'DEPLOYMENT_MODE',
    'ALLOW_LOCAL_AI_ENDPOINTS',
    'DISABLE_HTTPS_ENFORCEMENT',
    'GRM_DISABLE_WEB_SETUP',
    'CREDENTIAL_ENCRYPTION_KEY_PREVIOUS',
    'DB_BACKUP_DIR',
    'GH_CACHE_MAX_AGE_DAYS',
    'EVENT_RETENTION_DAYS',
    'EMAIL_RETRY_BASE_DELAY_MS',
    'WORK_BOARD_SNAPSHOT_RETENTION_DAYS',
    'SQLITE_VERBOSE',
    'ENV_TOOLING_INSTALL_ENABLED',
    'UPDATE_CHECK',
];

describe('B-12: schema <-> .env.example <-> docs/operations.md parity', () => {
    const configSrc = readFileSync('server/config.js', 'utf8');
    const envExampleSrc = readFileSync('.env.example', 'utf8');
    const opsSrc = readFileSync('docs/operations.md', 'utf8');

    it('every tracked var is read (validated) by server/config.js', () => {
        const missing = TRACKED_VARS.filter(
            (name) => !configSrc.includes(`process.env.${name}`),
        );
        expect(missing, 'not read/validated in server/config.js').toEqual([]);
    });

    it('every tracked var appears in .env.example', () => {
        const missing = TRACKED_VARS.filter((name) => !envExampleSrc.includes(name));
        expect(missing, 'missing from .env.example — a self-hoster copying the template never sees it').toEqual([]);
    });

    it('every tracked var appears in docs/operations.md', () => {
        const missing = TRACKED_VARS.filter((name) => !opsSrc.includes(name));
        expect(missing, 'missing from docs/operations.md — undocumented for operators').toEqual([]);
    });
});
