#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.

/**
 * CLI entry point for the data-retention enforcement pass.
 *
 * Usage:
 *   node server/scripts/retention.js             # live run
 *   node server/scripts/retention.js --dry-run   # simulate without writing
 *
 * Or via npm:
 *   npm run retention:run
 *   npm run retention:dry
 */

// MUST precede any import that reaches db.js: the SQLite path is resolved from
// process.env.DATA_DIR during module evaluation, so an operator CLI that skips
// this opens <repo>/server/data instead of the configured data directory —
// silently creating and reporting on an empty database.
import '../lib/env/load-dotenv.js'

import { runRetentionPass } from '../lib/retention.js'

const dryRun = process.argv.includes('--dry-run')

try {
    const result = await runRetentionPass({ dryRun })
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    process.exit(0)
} catch (err) {
    console.error('Retention pass failed:', err)
    process.exit(1)
}
