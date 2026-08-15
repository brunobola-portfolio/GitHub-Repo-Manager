#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.

import { generateLicenseKey, parseLicenseKey } from '../server/lib/license.js'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseArgs } from 'util'

const __dirname = dirname(fileURLToPath(import.meta.url))

const { values } = parseArgs({
  options: {
    tier: { type: 'string', default: 'pro' },
    org: { type: 'string', default: 'Self' },
    email: { type: 'string', default: '' },
    seats: { type: 'string', default: '1' },
    months: { type: 'string', default: '12' },
    'key-file': { type: 'string', default: join(__dirname, '..', 'keys', 'private.pem') },
  },
})

const keyFile = values['key-file']
if (!existsSync(keyFile)) {
  console.error(`ERROR: Private key not found at ${keyFile}`)
  console.error('Run: node scripts/generate-keys.js')
  process.exit(1)
}

if (!['pro', 'enterprise'].includes(values.tier)) {
  console.error('ERROR: --tier must be "pro" or "enterprise"')
  process.exit(1)
}

const seats = parseInt(values.seats, 10)
const months = parseInt(values.months, 10)

if (!Number.isFinite(seats) || seats < 1) {
  console.error('ERROR: --seats must be a positive integer')
  process.exit(1)
}

if (!Number.isFinite(months) || months < 1) {
  console.error('ERROR: --months must be a positive integer')
  process.exit(1)
}

const privateKeyPem = readFileSync(keyFile, 'utf-8')

const key = await generateLicenseKey({
  org: values.org,
  email: values.email,
  tier: values.tier,
  seats,
  months,
}, privateKeyPem)

const payload = parseLicenseKey(key)
const expiresAt = new Date(payload.exp * 1000).toISOString().split('T')[0]

console.log('')
console.log('License generated successfully!')
console.log(`  ID:      ${payload.lid}`)
console.log(`  Tier:    ${payload.tier}`)
console.log(`  Org:     ${payload.org}`)
console.log(`  Email:   ${payload.email || '(none)'}`)
console.log(`  Seats:   ${payload.seats}`)
console.log(`  Expires: ${expiresAt}`)
console.log('')
console.log('License Key:')
console.log(key)
console.log('')
console.log('Add to .env:')
console.log(`LICENSE_KEY=${key}`)
