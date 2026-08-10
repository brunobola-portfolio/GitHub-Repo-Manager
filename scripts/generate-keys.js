#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.

import { generateKeyPair } from '../server/lib/license.js'
import { writeFileSync, existsSync, mkdirSync, openSync, closeSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const keysDir = join(__dirname, '..', 'keys')

if (!existsSync(keysDir)) mkdirSync(keysDir, { recursive: true })

const privatePath = join(keysDir, 'private.pem')
const publicPath = join(keysDir, 'public.pem')

if (existsSync(privatePath)) {
  console.error('ERROR: keys/private.pem already exists.')
  console.error('Delete it manually if you want to regenerate (this will invalidate ALL existing licenses).')
  process.exit(1)
}

const { privateKey, publicKey } = await generateKeyPair()

// 'wx' fails if the path exists, so the existence check above is a helpful
// early message rather than the actual guard. Between that check and this
// write, a concurrent run could otherwise clobber a private key and invalidate
// every licence ever issued. 0o600 because this file is the signing key.
try {
  closeSync(openSync(privatePath, 'wx', 0o600))
} catch (err) {
  if (err.code === 'EEXIST') {
    console.error('ERROR: keys/private.pem appeared while this run was working. Nothing was overwritten.')
    process.exit(1)
  }
  throw err
}
writeFileSync(privatePath, privateKey, 'utf-8')
writeFileSync(publicPath, publicKey, 'utf-8')

console.log('Ed25519 keypair generated successfully!')
console.log(`  Private key: ${privatePath}`)
console.log(`  Public key:  ${publicPath}`)
console.log('')
console.log('IMPORTANT: Never commit keys/private.pem to git.')
console.log('The public key (keys/public.pem) is safe to commit.')
