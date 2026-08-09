#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
/*
 * Emits the four security-critical secrets a production install needs, each
 * independently random. Distinct values matter: CREDENTIAL_ENCRYPTION_KEY
 * falls back to SESSION_SECRET when unset in development
 * (server/lib/credential-encryption.js; in production an unset key aborts
 * boot), so reusing one string means a leaked session store also decrypts
 * every stored BYOK key and Azure PAT — one compromise instead of two.
 *
 *   node scripts/generate-secrets.mjs            → .env lines on stdout
 *   node scripts/generate-secrets.mjs --json     → JSON object
 *   node scripts/generate-secrets.mjs --append <path>  → append to an env file
 *
 * --append never overwrites: it refuses if any of the four keys already has a
 * non-empty value in the target file, because silently rotating
 * CREDENTIAL_ENCRYPTION_KEY strands every credential already encrypted under
 * the old one (see CREDENTIAL_ENCRYPTION_KEY_PREVIOUS in .env.example for the
 * supported rotation path).
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

// startup-secrets-check.js hard-fails production boot on anything shorter
// than 32 characters; 48 raw bytes of base64 is 64 characters, comfortably
// clear of that floor with room for the CREDENTIAL_ENCRYPTION_KEY hex form.
export const SECRET_SPECS = [
  { key: 'SESSION_SECRET', bytes: 48, encoding: 'base64' },
  { key: 'API_KEY_SECRET', bytes: 48, encoding: 'base64' },
  { key: 'WEBHOOK_SECRET', bytes: 48, encoding: 'base64' },
  // hex, not base64: this one is read as raw key material for AES-256-GCM
  // (server/lib/credential-encryption.js) and hex avoids any +/= ambiguity
  // when it travels through shell quoting or a Windows service manager.
  { key: 'CREDENTIAL_ENCRYPTION_KEY', bytes: 32, encoding: 'hex' },
]

/** @returns {Record<string, string>} one fresh secret per SECRET_SPECS entry */
export function generateSecrets() {
  const out = {}
  for (const { key, bytes, encoding } of SECRET_SPECS) {
    out[key] = randomBytes(bytes).toString(encoding)
  }
  return out
}

/** Render as `.env` assignment lines (no trailing newline). */
export function formatEnvLines(secrets) {
  return Object.entries(secrets).map(([k, v]) => `${k}=${v}`).join('\n')
}

/**
 * Which of `keys` already carry a non-empty value in an env-file body.
 * Commented-out lines (`# KEY=…`) and bare `KEY=` placeholders do not count —
 * those are the templates this script is meant to fill in.
 */
export function findPopulatedKeys(envBody, keys) {
  // Strip a UTF-8 BOM (U+FEFF). dotenv honours a BOM-prefixed
  // `SESSION_SECRET=…` as a real assignment, but the `^` anchor does not match
  // after the BOM — so a Notepad-saved file looked EMPTY to this guard while
  // the running app read a value from it. Appending then adds a second
  // assignment, and dotenv takes the last one: CREDENTIAL_ENCRYPTION_KEY
  // silently rotates and every stored credential becomes undecryptable. That
  // is precisely the disaster this function exists to prevent, so it must not
  // have blind spots.
  const body = envBody.replace(/^\uFEFF/, '')
  const populated = []
  for (const key of keys) {
    // `export KEY=value` is also honoured by dotenv and was also invisible here.
    //
    // `gm` + LAST match, not `m` + exec. dotenv resolves a duplicated key to
    // its LAST occurrence, so a file holding
    //     SESSION_SECRET=
    //     SESSION_SECRET=the-real-one
    // is populated as far as the running app is concerned, while a first-match
    // scan sees the empty placeholder and reports it free. Appending then adds
    // a third assignment which wins \u2014 rotating CREDENTIAL_ENCRYPTION_KEY under
    // a database full of credentials encrypted with the second. Matching
    // dotenv's own resolution order is the whole point of this function.
    const re = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=[ \\t]*(.*)$`, 'gm')
    const matches = [...body.matchAll(re)]
    const last = matches[matches.length - 1]
    if (last && last[1].trim() !== '') populated.push(key)
  }
  return populated
}

/**
 * Append `secrets` to an env file, refusing if any key already carries a value.
 *
 * Extracted from the CLI so the refuse-to-overwrite branch is testable. It was
 * previously inline in main(), which no test exercised — a mutation that
 * disabled the guard entirely left the whole suite green, even though that
 * branch is the only thing standing between an operator and an accidental
 * CREDENTIAL_ENCRYPTION_KEY rotation.
 *
 * @returns {{ ok: true, count: number } | { ok: false, clash: string[] }}
 */
export function appendSecretsToFile(target, secrets, io = fs) {
  // Read-and-catch rather than existsSync-then-read. An exists check followed
  // by a write is a time-of-check/time-of-use window on a file whose entire
  // content is secrets: between the two, something could create the path — or
  // a symlink pointing somewhere else. Every branch below acts on a handle or
  // fails, so there is no gap to exploit.
  let existing = ''
  let targetExists = true
  try {
    existing = io.readFileSync(target, 'utf8')
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    targetExists = false
  }

  const clash = findPopulatedKeys(existing, Object.keys(secrets))
  if (clash.length) return { ok: false, clash }

  const prefix = existing && !existing.endsWith('\n') ? '\n' : ''
  const block = `${prefix}\n# Generated by scripts/generate-secrets.mjs\n${formatEnvLines(secrets)}\n`

  if (!targetExists) {
    // 'wx' is an atomic exclusive create — it fails rather than truncating if
    // the path appeared since the read above. The mode also fixes a
    // permissions problem: appendFileSync on a NEW file uses 0666 & ~umask,
    // typically 0644, i.e. world-readable. No-op on Windows, which ignores it.
    const fd = io.openSync(target, 'wx', 0o600)
    try {
      io.writeSync(fd, block)
    } finally {
      io.closeSync(fd)
    }
  } else {
    io.appendFileSync(target, block)
  }
  return { ok: true, count: Object.keys(secrets).length }
}

function main(argv) {
  const asJson = argv.includes('--json')
  const appendIdx = argv.indexOf('--append')
  const secrets = generateSecrets()

  if (appendIdx !== -1) {
    const target = argv[appendIdx + 1]
    if (!target) {
      console.error('--append requires a file path')
      process.exit(1)
    }
    const result = appendSecretsToFile(target, secrets)
    if (!result.ok) {
      console.error(`Refusing to append: ${result.clash.join(', ')} already set in ${target}.`)
      console.error('A second assignment would shadow the first (dotenv takes the last one), rotating these in place and stranding existing sessions and encrypted credentials.')
      console.error('See CREDENTIAL_ENCRYPTION_KEY_PREVIOUS in .env.example for the supported rotation path.')
      process.exit(1)
    }
    console.log(`Appended ${result.count} secrets to ${target}`)
    return
  }

  console.log(asJson ? JSON.stringify(secrets, null, 2) : formatEnvLines(secrets))
}

// Only run the CLI when invoked directly, so the tests can import the helpers.
// pathToFileURL (not a hand-built file:// string) is what makes this comparison
// hold on Windows, where argv[1] is a `D:\…` path with backslashes.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
