// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.
/**
 * Shared CLI utilities for server/scripts/ operator tools.
 *
 * Zero runtime deps — `commander` and `yargs` are intentionally avoided.
 * Keep this file < 80 LOC.
 */
import readline from 'node:readline';

/**
 * Parse a minimal argv vector into { positional, flags }.
 *   --foo bar   -> flags.foo = 'bar'
 *   --foo=bar   -> flags.foo = 'bar'
 *   --foo       -> flags.foo = true   (boolean when no value follows)
 *   plain tokens -> positional[]
 */
export function parseArgs(argv) {
    const flags = {};
    const positional = [];
    const args = Array.isArray(argv) ? argv.slice() : [];
    while (args.length) {
        const tok = args.shift();
        if (tok.startsWith('--')) {
            const body = tok.slice(2);
            const eq = body.indexOf('=');
            if (eq !== -1) {
                flags[body.slice(0, eq)] = body.slice(eq + 1);
            } else if (args.length && !args[0].startsWith('--')) {
                flags[body] = args.shift();
            } else {
                flags[body] = true;
            }
        } else {
            positional.push(tok);
        }
    }
    return { positional, flags };
}

/**
 * Print rows as a fixed-width ASCII table to stdout.
 * `columns` is an array of { key, label } pairs.
 */
export function printTable(rows, columns, out = process.stdout) {
    const widths = columns.map(c => Math.max(
        c.label.length,
        ...rows.map(r => String(r[c.key] ?? '').length),
    ));
    const fmt = (vals) => vals.map((v, i) => String(v).padEnd(widths[i])).join('  ');
    out.write(fmt(columns.map(c => c.label)) + '\n');
    out.write(widths.map(w => '-'.repeat(w)).join('  ') + '\n');
    for (const r of rows) out.write(fmt(columns.map(c => r[c.key] ?? '')) + '\n');
}

/**
 * Prompt y/N on stdin. If `assumeYes` is true, resolves to true without
 * touching the TTY — pass through `--yes` flag for CI/headless runs.
 */
export function askConfirm(message, { assumeYes = false } = {}) {
    if (assumeYes) return Promise.resolve(true);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(`${message} [y/N] `, (ans) => {
            rl.close();
            resolve(/^y(es)?$/i.test(String(ans).trim()));
        });
    });
}
