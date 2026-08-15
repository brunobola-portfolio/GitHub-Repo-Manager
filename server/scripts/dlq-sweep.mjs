#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.
/**
 * Hard-delete resolved DLQ rows older than N days so the dead-letter tables
 * don't grow unbounded. Distinct from the retry workers — those only touch
 * *unresolved* rows; this touches *resolved* rows.
 *
 * Usage:
 *   node server/scripts/dlq-sweep.mjs [--email|--webhook|--both] [--days 30] [--dry-run] [--yes]
 *
 * Defaults: --both, --days 30, --dry-run=true. Pass `--dry-run=false` (or the
 * absence via explicit `--days N` + `--yes` without the flag) to actually
 * delete.
 */
// MUST precede any import that reaches db.js: the SQLite path is resolved from
// process.env.DATA_DIR during module evaluation, so an operator CLI that skips
// this opens <repo>/server/data instead of the configured data directory —
// silently creating and reporting on an empty database.
import '../lib/env/load-dotenv.js'

import { pathToFileURL } from 'node:url';
import { parseArgs, askConfirm } from './_cli-utils.mjs';

const TABLES = {
    email: 'email_dead_letter',
    webhook: 'webhook_events_dead_letter',
};

/**
 * Count resolved rows older than `days`. Used for dry-run reporting.
 */
export function countSweepable({ db, queue, days }) {
    const table = TABLES[queue];
    if (!table) throw new Error(`Unknown queue: ${queue}`);
    const row = db.prepare(
        `SELECT COUNT(*) AS n FROM ${table}
         WHERE resolved_at IS NOT NULL
           AND resolved_at < datetime('now', ?)`,
    ).get(`-${days} days`);
    return row.n;
}

/**
 * Hard-delete resolved rows older than `days`. Returns the row-count.
 */
export function sweep({ db, queue, days }) {
    const table = TABLES[queue];
    if (!table) throw new Error(`Unknown queue: ${queue}`);
    const info = db.prepare(
        `DELETE FROM ${table}
         WHERE resolved_at IS NOT NULL
           AND resolved_at < datetime('now', ?)`,
    ).run(`-${days} days`);
    return info.changes;
}

// ---------------------------------------------------------------------------
// CLI bootstrap
// ---------------------------------------------------------------------------
function resolveQueues(flags) {
    if (flags.both) return ['email', 'webhook'];
    if (flags.email && !flags.webhook) return ['email'];
    if (flags.webhook && !flags.email) return ['webhook'];
    // Default: both.
    return ['email', 'webhook'];
}

/**
 * Format a cutoff YYYY-MM-DD string N days before today. Kept pure + UTC so
 * the dry-run output is stable regardless of the operator's timezone.
 */
function cutoffDate(days) {
    const d = new Date(Date.now() - days * 86400_000);
    return d.toISOString().slice(0, 10);
}

async function main(argv) {
    const { flags } = parseArgs(argv);
    const days = Number.parseInt(flags.days, 10) || 30;
    // --dry-run defaults to TRUE. The flag with no value is truthy; an explicit
    // `--dry-run=false` (or `--dry-run false`) opts out.
    const dryRun = flags['dry-run'] === undefined ? true :
        !(flags['dry-run'] === 'false' || flags['dry-run'] === false);

    const queues = resolveQueues(flags);
    const { default: db, initDB } = await import('../db.js');
    initDB();

    const cutoff = cutoffDate(days);

    if (dryRun) {
        for (const q of queues) {
            const n = countSweepable({ db, queue: q, days });
            process.stdout.write(
                `Would delete ${n} ${q} DLQ rows older than ${cutoff}\n`,
            );
        }
        return 0;
    }

    if (!flags.yes) {
        const ok = await askConfirm(
            `Really hard-delete resolved ${queues.join(' + ')} DLQ rows older than ${days} days?`,
        );
        if (!ok) { process.stdout.write('Aborted.\n'); return 0; }
    }

    for (const q of queues) {
        const n = sweep({ db, queue: q, days });
        process.stdout.write(`Deleted ${n} ${q} DLQ rows\n`);
    }
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
        process.stderr.write(`dlq-sweep failed: ${err.message}\n`);
        process.exit(1);
    });
}
