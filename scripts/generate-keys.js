#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.

import { generateKeyPair } from '../server/lib/license.js'
import { writeFileSync, existsSync, mkdirSync, openSync, closeSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const keysDir = join(__dirname, '..', 'keys')

if (!existsSync(keysDir)) mkdirSync(keysDir, { recursive: true })

const privatePath = join(keysDir, 'private.pem')
const publicPath = join(keysDir, 'public.pem')

const { privateKey, publicKey } = await generateKeyPair()

// The exclusive create IS the guard — there is no existence check before it on
// purpose. Overwriting this file invalidates every licence ever issued, and a
// check-then-write leaves a window in which a second run does exactly that.
// 0o600 because this file is the signing key.
let handle
try {
  handle = openSync(privatePath, 'wx', 0o600)
} catch (err) {
  if (err.code === 'EEXIST') {
    console.error('ERROR: keys/private.pem already exists. Nothing was overwritten.')
    console.error('Delete it manually if you want to regenerate (this will invalidate ALL existing licenses).')
    process.exit(1)
  }
  throw err
}
writeFileSync(handle, privateKey, 'utf-8')
closeSync(handle)
writeFileSync(publicPath, publicKey, 'utf-8')

console.log('Ed25519 keypair generated successfully!')
console.log(`  Private key: ${privatePath}`)
console.log(`  Public key:  ${publicPath}`)
console.log('')
console.log('IMPORTANT: Never commit keys/private.pem to git.')
console.log('The public key (keys/public.pem) is safe to commit.')
