#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
// Commercial license: https://bolalabs.pt/license

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

import { runRetentionPass } from '../lib/retention.js'

const dryRun = process.argv.includes('--dry-run')

try {
    const result = await runRetentionPass({ dryRun })
    console.log(JSON.stringify(result, null, 2))
    process.exit(0)
} catch (err) {
    console.error('Retention pass failed:', err)
    process.exit(1)
}
