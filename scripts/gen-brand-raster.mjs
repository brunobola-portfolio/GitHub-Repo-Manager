#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
/*
 * Rasterises the brand kit: PNGs, the Windows .ico, and the social card.
 *
 * Split from gen-brand.mjs because this one needs a browser (Playwright) to
 * render SVG, while the SVG generator must stay dependency-free so its --check
 * gate can run on any machine and in CI.
 *
 *   node scripts/gen-brand-raster.mjs
 *
 * The .ico is assembled here rather than by a converter tool: each slot gets
 * the OPTICALLY CORRECT cut (small at 16/24, display at 32 and up), which no
 * generic svg-to-ico converter will do — they scale one source and hand you a
 * smudge in the 16 slot. That distinction is the whole reason this file exists.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'brand')

// slot size → which SVG source. The cut switches at 32: below that the ring is
// sub-pixel and has to go. See docs/BRAND.md "Optical sizes".
const ICO_SLOTS = [
  // public/logo.svg IS the small-cut tile — the same file the browser tab uses.
  // Reading it directly keeps one source for the 16/24 artwork instead of a
  // second copy that could drift.
  { size: 16, src: 'public/logo.svg' },
  { size: 24, src: 'public/logo.svg' },
  { size: 32, src: 'brand/tile-windows.svg' },
  { size: 48, src: 'brand/tile-windows.svg' },
  { size: 64, src: 'brand/tile-windows.svg' },
  { size: 256, src: 'brand/tile-windows.svg' },
]

const PNGS = [
  { out: 'favicon-32.png', src: 'public/logo.svg', size: 32 },
  { out: 'favicon-16.png', src: 'public/logo.svg', size: 16 },
  { out: 'apple-touch-icon.png', src: 'brand/tile-windows.svg', size: 180 },
  { out: 'icon-512.png', src: 'brand/tile-windows.svg', size: 512 },
  { out: 'icon-1024-macos.png', src: 'brand/tile-macos.svg', size: 1024 },
]

async function renderPng(page, svgPath, size) {
  const svg = fs.readFileSync(path.join(ROOT, svgPath), 'utf8')
  // Transparent page: tiles carry their own ground, and anything outside a
  // rounded corner must stay transparent or macOS shows a square halo.
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<!doctype html><style>
       html,body{margin:0;padding:0;background:transparent}
       svg{display:block;width:${size}px;height:${size}px}
     </style>${svg}`,
    { waitUntil: 'load' }
  )
  return page.screenshot({ omitBackground: true, type: 'png' })
}

/**
 * Assemble an .ico from PNG buffers.
 *
 * ICO is a 6-byte header, then one 16-byte directory entry per image, then the
 * payloads. PNG payloads have been legal inside .ico since Windows Vista, which
 * is what lets a 256×256 slot exist at all — a BMP one would be 256 KB.
 */
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)              // reserved
  header.writeUInt16LE(1, 2)              // type 1 = icon
  header.writeUInt16LE(images.length, 4)

  const dir = Buffer.alloc(16 * images.length)
  let offset = header.length + dir.length

  images.forEach((img, i) => {
    const b = i * 16
    // 256 is encoded as 0 — the field is one byte and 256 does not fit.
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, b + 0)
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, b + 1)
    dir.writeUInt8(0, b + 2)              // palette count
    dir.writeUInt8(0, b + 3)              // reserved
    dir.writeUInt16LE(1, b + 4)           // colour planes
    dir.writeUInt16LE(32, b + 6)          // bits per pixel
    dir.writeUInt32LE(img.data.length, b + 8)
    dir.writeUInt32LE(offset, b + 12)
    offset += img.data.length
  })

  return Buffer.concat([header, dir, ...images.map((i) => i.data)])
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ deviceScaleFactor: 1 })

  try {
    for (const { out, src, size } of PNGS) {
      fs.writeFileSync(path.join(OUT, out), await renderPng(page, src, size))
      console.log(`  ${out}  (${size}px)`)
    }

    const images = []
    for (const { size, src } of ICO_SLOTS) {
      images.push({ size, data: await renderPng(page, src, size) })
    }
    const ico = buildIco(images)
    fs.writeFileSync(path.join(OUT, 'repomanager.ico'), ico)
    fs.writeFileSync(path.join(ROOT, 'packaging/windows/assets/repomanager.ico'), ico)
    console.log(`  repomanager.ico  (${ICO_SLOTS.map((s) => s.size).join('/')}, ${(ico.length / 1024).toFixed(0)} KB)`)

    // Social card. Built as a real layout rather than a scaled tile so the
    // wordmark sits at its designed size instead of being stretched.
    await page.setViewportSize({ width: 1200, height: 630 })
    const tile = fs.readFileSync(path.join(ROOT, 'brand/tile-windows.svg'), 'utf8')
    // Laid out as a card, not a scaled tile: the mark sits on the optical
    // centre line with the type, and the tagline is never allowed to wrap —
    // "…needs / you." reads as a broken sentence in a link preview, which is
    // the one place the reader has no context to repair it.
    await page.setContent(`<!doctype html><style>
      html,body{margin:0;height:630px;background:#020617;
        font-family:Archivo,ui-sans-serif,system-ui,sans-serif;color:#f8fafc}
      .c{height:100%;display:flex;flex-direction:column;justify-content:center;
         padding:0 96px;gap:0}
      .top{display:flex;align-items:center;gap:34px;margin-bottom:46px}
      svg{width:150px;height:150px;display:block;flex:0 0 150px}
      h1{font-size:96px;font-weight:700;letter-spacing:-.035em;margin:0;line-height:.92}
      p{font-size:37px;color:#94a3b8;margin:0;line-height:1.25;white-space:nowrap}
      .n{color:#8fd23f}
      .foot{position:absolute;left:96px;bottom:56px;font-size:23px;color:#475569;
            letter-spacing:.04em}
    </style><div class="c">
      <div class="top">${tile}<h1>RepoManager</h1></div>
      <p>The repository that needs you<span class="n">.</span></p>
      <div class="foot">bolalabs.pt</div>
    </div>`, { waitUntil: 'load' })
    fs.writeFileSync(path.join(OUT, 'og-1200x630.png'), await page.screenshot({ type: 'png' }))
    console.log('  og-1200x630.png  (1200x630)')
  } finally {
    await browser.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1) })
}

export { buildIco }
