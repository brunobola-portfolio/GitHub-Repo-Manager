#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
// Commercial license: https://bolalabs.pt/license
/**
 * Grant (or revoke) the `is_admin` flag on a user row.
 *
 * Usage:
 *   node server/scripts/admin-grant.mjs --user <github-username|numeric-id> [--revoke]
 *
 * Audit-logs the action so there's a tamper-evident chain record of who was
 * promoted when. Exits 0 on success, 1 on miss, 2 on usage error.
 */
// MUST precede any import that reaches db.js: the SQLite path is resolved from
// process.env.DATA_DIR during module evaluation, so an operator CLI that skips
// this opens <repo>/server/data instead of the configured data directory —
// silently creating and reporting on an empty database.
import '../lib/env/load-dotenv.js'

import { pathToFileURL } from 'node:url';
import { parseArgs } from './_cli-utils.mjs';

/**
 * Core: look up a user by login-or-id and toggle `is_admin`.
 * `db` must be a better-sqlite3-compatible handle with the v3.6.0 schema.
 * `audit` is an optional function called with a descriptor for the action.
 */
export function grantAdmin({ db, user, revoke = false, audit = null, actorUserId = 0 }) {
    if (!user) throw new Error('user is required');

    // Resolve by numeric id first (if the caller passed an integer-looking token),
    // otherwise by exact username match. A user CAN have an all-digits login
    // in theory, but GitHub disallows that — so "all digits" is safe to treat
    // as an id lookup.
    const asInt = Number.parseInt(user, 10);
    const row = /^\d+$/.test(String(user))
        ? db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(asInt)
        : db.prepare('SELECT id, username, is_admin FROM users WHERE username = ?').get(String(user));

    if (!row) {
        return { ok: false, reason: 'not_found', user };
    }

    const next = revoke ? 0 : 1;
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(next, row.id);

    if (audit) {
        audit({
            actor_user_id: actorUserId,
            action: revoke ? 'admin.revoke' : 'admin.grant',
            entity_type: 'user',
            entity_id: row.id,
            metadata: { username: row.username, previous_is_admin: row.is_admin ? 1 : 0 },
        });
    }

    return { ok: true, id: row.id, username: row.username, revoke };
}

// ---------------------------------------------------------------------------
// CLI bootstrap — only runs when invoked as the entry module.
// ---------------------------------------------------------------------------
async function main(argv) {
    const { flags } = parseArgs(argv);
    if (!flags.user || flags.user === true) {
        process.stderr.write('Usage: admin-grant.mjs --user <github-username-or-userId> [--revoke]\n');
        return 2;
    }

    const { default: db, initDB } = await import('../db.js');
    // Ensure schema (including is_admin from migration 016) is applied. Idempotent.
    initDB();
    const { auditLogDirect } = await import('../lib/audit.js');

    const result = grantAdmin({
        db,
        user: String(flags.user),
        revoke: Boolean(flags.revoke),
        audit: auditLogDirect,
        actorUserId: 0, // CLI / operator — no session
    });

    if (!result.ok) {
        process.stderr.write(`No user matched '${result.user}'\n`);
        return 1;
    }

    const verb = result.revoke ? 'admin revoked' : 'granted admin';
    process.stdout.write(`\u2713 User ${result.username} (id=${result.id}) ${verb}\n`);
    return 0;
}

// Cross-platform entry-point check: on Windows `process.argv[1]` is a native
// path (`S:\...\admin-grant.mjs`), while `import.meta.url` is a file:// URL.
// Convert the argv path to a URL before comparing so this works on both OSes.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
        process.stderr.write(`admin-grant failed: ${err.message}\n`);
        process.exit(1);
    });
}
