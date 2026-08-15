#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.
/**
 * Verify the audit log's hash chain (SOC 2 CC7.2 tamper detection).
 *
 * Usage:
 *   npm run audit:verify
 *   npm run audit:verify -- --from 1000 --to 2000
 *   npm run audit:verify -- --json
 *
 * Two runbooks — docs/operations.md and docs/guides/admin-dlq.md — told
 * operators to run `npm run audit:verify` after restoring from a backup or on
 * suspicion of tampering. The script did not exist, so the only documented
 * tamper-detection step in the whole runbook exited with "Missing script".
 * The underlying verifyAuditChain() has always been there; this is the CLI
 * wrapper the docs promised.
 *
 * Exit codes: 0 chain intact · 1 chain broken · 2 usage error.
 */
// MUST precede any import that reaches db.js: the SQLite path is resolved from
// process.env.DATA_DIR during module evaluation, so an operator CLI that skips
// this opens <repo>/server/data instead of the configured data directory —
// silently creating and reporting on an empty database.
import '../lib/env/load-dotenv.js'

import { pathToFileURL } from 'node:url';
import { parseArgs } from './_cli-utils.mjs';

/** Parse an optional numeric bound, rejecting anything non-numeric. */
function parseBound(value, name) {
    if (value === undefined) return undefined;
    const n = Number.parseInt(String(value), 10);
    if (!Number.isFinite(n) || String(n) !== String(value).trim()) {
        throw new Error(`--${name} must be an integer row id (got "${value}")`);
    }
    return n;
}

/**
 * Render a verification result for humans. Kept separate from main() so the
 * formatting is testable without touching a database.
 */
export function formatResult(result) {
    // Rows written before the hash-chain migration carry no hash. Saying so
    // explicitly beats both alternatives: calling them broken is a false alarm
    // (this repo's own dev database has 3 such rows), and staying silent would
    // imply they had been verified.
    const legacyNote = result.unhashedLegacy
        ? `\n  Note: ${result.unhashedLegacy} row(s) predate the hash chain and cannot be verified.`
        : '';

    if (result.valid) {
        if (result.totalChecked === 0) {
            return result.unhashedLegacy
                ? `No hashed rows to verify.${legacyNote}`
                : 'Audit log is empty — nothing to verify.';
        }
        return `✓ Audit chain intact across ${result.totalChecked} row(s).${legacyNote}`;
    }
    return [
        `✗ Audit chain BROKEN at row id ${result.brokenAt}.`,
        `  ${result.totalChecked} row(s) verified before the break.`,
        '  Rows at or after that id no longer match their recorded hashes:',
        '  either the database was edited outside the application, or it was',
        '  restored from a backup taken mid-write. Preserve a copy before',
        '  investigating — re-running the app will keep appending to the chain.',
    ].join('\n') + legacyNote;
}

async function main(argv) {
    const { flags } = parseArgs(argv);

    let from;
    let to;
    try {
        from = parseBound(flags.from, 'from');
        to = parseBound(flags.to, 'to');
    } catch (err) {
        process.stderr.write(`${err.message}\n`);
        return 2;
    }

    const { initDB } = await import('../db.js');
    initDB();
    const { verifyAuditChain } = await import('../lib/audit.js');

    const result = verifyAuditChain({ from, to });

    if (flags.json) {
        process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
        const out = formatResult(result);
        (result.valid ? process.stdout : process.stderr).write(`${out}\n`);
    }

    return result.valid ? 0 : 1;
}

// Cross-platform entry-point check: on Windows `process.argv[1]` is a native
// path while `import.meta.url` is a file:// URL. Convert before comparing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
        process.stderr.write(`audit:verify failed: ${err.message}\n`);
        process.exit(1);
    });
}
