#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
// Commercial license: https://bolalabs.pt/license
/**
 * Operator CLI for inspecting and acting on the email + webhook dead-letter
 * queues without hand-rolled SQL.
 *
 * Usage:
 *   node server/scripts/admin-dlq.mjs [email|webhook] [summary|list|retry|resolve] \
 *       [--id <id>] [--unresolved-only] [--yes]
 *
 * Defaults: queue=email, action=summary. If both positionals are omitted, help
 * is printed to stderr and the process exits 2 (usage error).
 */
import { pathToFileURL } from 'node:url';
import { parseArgs, printTable } from './_cli-utils.mjs';

const QUEUES = {
    email: {
        table: 'email_dead_letter',
        listCols: ['id', 'to_address', 'subject', 'attempts', 'last_error', 'next_retry_at'],
        auditPrefix: 'dlq.email',
        resourceType: 'email_dlq',
    },
    webhook: {
        table: 'webhook_events_dead_letter',
        listCols: ['id', 'delivery_id', 'event_type', 'attempts', 'last_error', 'next_retry_at'],
        auditPrefix: 'dlq.webhook',
        resourceType: 'webhook_dlq',
    },
};

/** Counts row snapshot used by the summary verb. */
export function dlqSummary({ db, queue }) {
    const cfg = QUEUES[queue];
    if (!cfg) throw new Error(`Unknown queue: ${queue}`);
    const unresolved = db.prepare(
        `SELECT COUNT(*) AS n FROM ${cfg.table} WHERE resolved_at IS NULL`,
    ).get().n;
    const resolved = db.prepare(
        `SELECT COUNT(*) AS n FROM ${cfg.table} WHERE resolved_at IS NOT NULL`,
    ).get().n;
    const overAttempts = db.prepare(
        `SELECT COUNT(*) AS n FROM ${cfg.table} WHERE attempts > 5 AND resolved_at IS NULL`,
    ).get().n;
    return { queue, unresolved, resolved, overAttempts };
}

/** Row list for the `list` verb. Truncates last_error to 60 chars. */
export function dlqList({ db, queue, unresolvedOnly = false, limit = 50 }) {
    const cfg = QUEUES[queue];
    if (!cfg) throw new Error(`Unknown queue: ${queue}`);
    const where = unresolvedOnly ? 'WHERE resolved_at IS NULL' : '';
    const rows = db.prepare(
        `SELECT ${cfg.listCols.join(', ')} FROM ${cfg.table} ${where} ORDER BY id DESC LIMIT ?`,
    ).all(limit);
    return rows.map(r => ({
        ...r,
        last_error: r.last_error && r.last_error.length > 60
            ? r.last_error.slice(0, 57) + '...'
            : r.last_error,
    }));
}

/** Force-schedule a row for the next worker tick. */
export function dlqRetry({ db, queue, id, audit = null, actorUserId = 0 }) {
    const cfg = QUEUES[queue];
    if (!cfg) throw new Error(`Unknown queue: ${queue}`);
    const info = db.prepare(
        `UPDATE ${cfg.table} SET next_retry_at = datetime('now') WHERE id = ? AND resolved_at IS NULL`,
    ).run(id);
    if (info.changes === 0) return { ok: false, reason: 'not_found_or_resolved', id };
    if (audit) {
        audit({
            actor_user_id: actorUserId,
            action: `${cfg.auditPrefix}.retry`,
            entity_type: cfg.resourceType,
            entity_id: id,
            metadata: { source: 'cli' },
        });
    }
    return { ok: true, id };
}

/** Soft-delete a row (set resolved_at + stamp last_error). */
export function dlqResolve({ db, queue, id, audit = null, actorUserId = 0 }) {
    const cfg = QUEUES[queue];
    if (!cfg) throw new Error(`Unknown queue: ${queue}`);
    const info = db.prepare(
        `UPDATE ${cfg.table}
         SET resolved_at = datetime('now'),
             last_error  = 'Operator-marked resolved (cli)'
         WHERE id = ? AND resolved_at IS NULL`,
    ).run(id);
    if (info.changes === 0) return { ok: false, reason: 'not_found_or_resolved', id };
    if (audit) {
        audit({
            actor_user_id: actorUserId,
            action: `${cfg.auditPrefix}.delete`,
            entity_type: cfg.resourceType,
            entity_id: id,
            metadata: { source: 'cli' },
        });
    }
    return { ok: true, id };
}

// ---------------------------------------------------------------------------
// CLI bootstrap
// ---------------------------------------------------------------------------
function usage() {
    process.stderr.write(
        'Usage: admin-dlq.mjs [email|webhook] [summary|list|retry|resolve] ' +
        '[--id <id>] [--unresolved-only] [--yes]\n',
    );
}

async function main(argv) {
    const { positional, flags } = parseArgs(argv);
    // Figure out queue + verb from leading positionals. Either may be omitted:
    //   admin-dlq.mjs              -> print help (exit 2)
    //   admin-dlq.mjs email        -> queue=email,   verb=summary
    //   admin-dlq.mjs webhook list -> queue=webhook, verb=list
    //   admin-dlq.mjs summary      -> queue=email,   verb=summary
    if (positional.length === 0) { usage(); return 2; }

    let queue = 'email';
    let verb = 'summary';
    const VERBS = new Set(['summary', 'list', 'retry', 'resolve']);
    if (QUEUES[positional[0]]) {
        queue = positional.shift();
    }
    if (positional.length && VERBS.has(positional[0])) {
        verb = positional.shift();
    }

    const { default: db, initDB } = await import('../db.js');
    initDB();
    const { auditLogDirect } = await import('../lib/audit.js');

    if (verb === 'summary') {
        const s = dlqSummary({ db, queue });
        process.stdout.write(`DLQ summary — ${queue}\n`);
        printTable(
            [s],
            [
                { key: 'unresolved',   label: 'unresolved' },
                { key: 'resolved',     label: 'resolved' },
                { key: 'overAttempts', label: 'attempts>5' },
            ],
        );
        return 0;
    }

    if (verb === 'list') {
        const rows = dlqList({ db, queue, unresolvedOnly: Boolean(flags['unresolved-only']) });
        if (rows.length === 0) {
            process.stdout.write(`(no ${queue} DLQ rows)\n`);
            return 0;
        }
        printTable(rows, QUEUES[queue].listCols.map(k => ({ key: k, label: k })));
        return 0;
    }

    const id = Number.parseInt(flags.id, 10);
    if (!Number.isFinite(id) || id < 1) {
        process.stderr.write(`--id <positive-integer> is required for ${verb}\n`);
        return 2;
    }

    if (verb === 'retry') {
        const r = dlqRetry({ db, queue, id, audit: auditLogDirect });
        if (!r.ok) { process.stderr.write(`No unresolved ${queue} DLQ row with id=${id}\n`); return 1; }
        process.stdout.write(`\u2713 Queued ${queue} DLQ id=${id} for immediate retry\n`);
        return 0;
    }

    if (verb === 'resolve') {
        const r = dlqResolve({ db, queue, id, audit: auditLogDirect });
        if (!r.ok) { process.stderr.write(`No unresolved ${queue} DLQ row with id=${id}\n`); return 1; }
        process.stdout.write(`\u2713 Resolved ${queue} DLQ id=${id}\n`);
        return 0;
    }

    usage();
    return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
        process.stderr.write(`admin-dlq failed: ${err.message}\n`);
        process.exit(1);
    });
}
