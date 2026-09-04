// SPDX-License-Identifier: Apache-2.0
/*
 * B-12 — every process.env.X read outside server/config.js and
 * server/lib/env/ must be an accounted-for name: either present in
 * config.js's zod schema (so a typo'd value fails fast at boot even if the
 * call site itself still reads process.env live — see the per-call-site
 * comments explaining why some do) or explicitly whitelisted below with a
 * reason. This is a ratchet: a brand-new `process.env.SOMETHING_NEW`
 * appearing anywhere else in server/ fails this test until it is a
 * deliberate decision, not an accident.
 *
 * Static regex scan rather than a runtime import: importing server/config.js
 * or server/index.js pulls in the whole boot chain (DB, session store); the
 * failure mode being guarded — a new call site appearing — is visible in the
 * source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

const ROOT = 'server';

// Names read outside config.js/lib/env that are intentionally NOT part of the
// B-12 pass (pre-existing, out of scope) or are not realistically
// schema-able. Each entry names the file(s) it covers so a removed call site
// can be pruned here too.
const WHITELIST = {
    // Per-feature/provider tuning knobs — numerous, low-risk (a bad value at
    // worst mis-tunes a retry/backoff), and out of scope for this pass.
    AI_DIFF_SIGNING_KEY: 'server/lib/work-board-ai-tokens.js — HMAC key, optional, falls back to a SESSION_SECRET-derived key',
    AI_MAX_OUTPUT_TOKENS: 'server/lib/ai-output-budget.js — per-call output-token cap, clamped in code',
    AI_RETRY_BASE_DELAY_MS: 'server/routes/ai/shared.js — provider retry backoff base delay',
    AI_SPEND_CAP_CENTS: 'server/lib/ai-spend-cap.js — legacy flat spend-cap override',
    AZURE_RETRY_BASE_MS: 'server/azure-service.js — Azure DevOps API retry backoff base delay',
    ALLOWED_AZURE_HOSTS: 'server/lib/azure-host-validator.js — comma-separated allowlist, parsed and validated in code',
    ALLOW_CONSOLE_EMAIL: 'server/lib/startup-secrets-check.js — downgrades a boot error to a warning; single-user/local installs only',
    BULK_DESTRUCTIVE_DAILY_MAX: 'server/lib/feature-flags.js — anti-abuse ceiling, identical across tiers',
    // Azure AD OAuth — optional interactive-signin credentials, PAT is the
    // simpler documented path; out of scope for this pass.
    AZURE_CLIENT_ID: 'server/routes/azure/oauth.js — optional Azure AD app registration',
    AZURE_CLIENT_SECRET: 'server/routes/azure/oauth.js — optional Azure AD app registration',
    AZURE_TENANT_ID: 'server/routes/azure/oauth.js — optional Azure AD app registration',
    // Runtime/packaging plumbing — not operator-facing config in the sense
    // config.js validates; these locate files or detect the launcher.
    DATA_DIR: 'server/lib/data-dir.js — resolved before config.js in the boot graph (see load-dotenv.js header)',
    GRM_ENV_FILE: 'server/lib/env/load-dotenv.js reads it directly to locate the .env file itself — cannot live inside the file it locates',
    GRM_MANAGED: 'server/lib/updater.js — set by the Windows package launcher to detect a managed install',
    GRM_PACKAGE_ROOT: 'server/lib/updater.js — Windows package install root, set by the launcher',
    // Platform/test-runner environment, not application config.
    SystemRoot: 'server/lib/updater.js — Windows platform env var (PowerShell resolution), not app config',
    SYSTEMROOT: 'server/lib/updater.js — same lookup, uppercase fallback spelling',
    VITEST: 'vitest sets this itself; read only to detect the test runner',
};

function serverFiles() {
    return readdirSync(ROOT, { recursive: true })
        .filter((f) => typeof f === 'string' && f.endsWith('.js'))
        .map((f) => join(ROOT, f).split(sep).join('/'))
        .filter((f) => !f.includes('/__tests__/'))
        .filter((f) => f !== 'server/config.js' && !f.startsWith('server/lib/env/'))
        .sort();
}

function schemaNames() {
    const src = readFileSync('server/config.js', 'utf8');
    const names = new Set();
    for (const m of src.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1]);
    return names;
}

// Matches process.env.NAME and process.env['NAME'] / ["NAME"].
const ENV_READ = /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\])/g;

function scan() {
    const found = new Map(); // name -> Set<file>
    for (const file of serverFiles()) {
        const src = readFileSync(file, 'utf8');
        for (const m of src.matchAll(ENV_READ)) {
            const name = m[1] || m[2];
            if (!found.has(name)) found.set(name, new Set());
            found.get(name).add(file);
        }
    }
    return found;
}

describe('B-12: process.env reads outside config.js are accounted for', () => {
    it('every distinct process.env.X name is schema-covered or whitelisted', () => {
        const schema = schemaNames();
        const found = scan();
        const unaccounted = [...found.keys()]
            .filter((name) => !schema.has(name) && !(name in WHITELIST))
            .sort();
        expect(
            unaccounted,
            'a new process.env.X read outside config.js/lib/env — add it to the ' +
            "zod schema in server/config.js (preferred) or to WHITELIST above with a reason",
        ).toEqual([]);
    });

    it('has no stale whitelist entries', () => {
        const found = scan();
        const schema = schemaNames();
        const stale = Object.keys(WHITELIST).filter(
            (name) => !found.has(name) || schema.has(name),
        );
        expect(stale, 'this name is no longer read outside config.js, or is now schema-covered — drop the whitelist entry').toEqual([]);
    });
});
