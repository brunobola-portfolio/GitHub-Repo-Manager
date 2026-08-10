#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
/*
 * Packs brand/ into a single downloadable archive.
 *
 * A brand page someone has to right-click their way through is a page, not a
 * media kit. Press, partners and contractors want one file. This builds it
 * from whatever is already in brand/, so it can never contain a mark the
 * generators did not produce.
 *
 *   node scripts/gen-brand-kit.mjs
 *
 * Separate from gen-brand.mjs (which must stay dependency-free so its --check
 * gate runs anywhere) and from gen-brand-raster.mjs (which needs a browser).
 * This one needs adm-zip, already a production dependency for the Windows
 * packaging.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import AdmZip from 'adm-zip'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BRAND = path.join(ROOT, 'brand')
const OUT = path.join(BRAND, 'repomanager-media-kit.zip')

// The archive is the only brand artefact that is not itself a mark, so it must
// never contain a previous copy of itself.
const EXCLUDE = new Set(['repomanager-media-kit.zip', 'index.html'])

const README = `RepoManager — media kit
=======================

Everything in this archive is generated from one geometry definition in
scripts/gen-brand.mjs. If you need a variant that is not here, ask rather than
redrawing it — a hand-made copy will not match.

CONTENTS

  mark-display.svg / -inverse    The mark at 25 px and up, light / dark grounds
  mark-small.svg   / -inverse    The mark at 24 px and below (ring dropped)
  mark-mono.svg                  Single colour, inherits currentColor
  lockup-horizontal.svg / -inverse, lockup-stacked.svg
  tile-macos.svg                 824 art in a 1024 canvas, radius 185.4
  tile-windows.svg               256 square, radius 30
  tile-adaptive.svg              Mark at 58%, survives a circular mask
  repomanager.ico                16/24/32/48/64/256, correct cut per slot
  favicon-16/32.png, apple-touch-icon.png, icon-512.png, icon-1024-macos.png
  og-1200x630.png                Social card
  fonts/                         Archivo, IBM Plex Sans, JetBrains Mono
  BRAND.md                       The written spec — read this first

THE TWO RULES THAT MATTER MOST

  1. There are two optical cuts. Below 25 px use the small cut; it is not the
     display mark scaled down, it is redrawn. Shipping the display cut at
     16 px is the one mistake this system exists to prevent.

  2. The lime #7fc528 is fill only, never text, and never means "healthy".

COLOUR   lime #7fc528 · ink #0f172a · paper #f8fafc · ground #020617
TYPE     Archivo (display) · IBM Plex Sans (text) · JetBrains Mono (data)

FONTS    Bundled under the SIL Open Font Licence 1.1. See fonts/OFL.txt; the
         licence must travel with them.

TRADEMARK
         RepoManager manages GitHub repositories and is not affiliated with,
         endorsed by, or sponsored by GitHub, Inc. Do not use GitHub's marks,
         wordmark or palette alongside these assets.

         RepoManager and the RepoManager mark are assets of Bola Labs, Inc.
         Use them to refer to the product. Do not modify, recolour or
         reconstruct the mark, and do not use it to imply a partnership that
         does not exist.

Full spec: BRAND.md · https://github.com/brunobola-portfolio/GitHub-Repo-Manager
`

function collect(dir, base = '') {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (EXCLUDE.has(rel)) continue
    if (entry.isDirectory()) out.push(...collect(path.join(dir, entry.name), rel))
    else out.push(rel)
  }
  return out.sort()
}

export function buildKit() {
  const zip = new AdmZip()
  const files = collect(BRAND)

  for (const rel of files) {
    zip.addFile(rel, fs.readFileSync(path.join(BRAND, rel)))
  }
  // The spec travels with the assets — a kit whose rules live in another
  // repository is a kit whose rules get ignored.
  zip.addFile('BRAND.md', fs.readFileSync(path.join(ROOT, 'docs/BRAND.md')))
  zip.addFile('README.txt', Buffer.from(README, 'utf8'))

  return { zip, entries: [...files, 'BRAND.md', 'README.txt'].sort() }
}

function main() {
  const { zip, entries } = buildKit()
  zip.writeZip(OUT)
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0)
  console.log(`  repomanager-media-kit.zip  (${entries.length} entries, ${kb} KB)`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
