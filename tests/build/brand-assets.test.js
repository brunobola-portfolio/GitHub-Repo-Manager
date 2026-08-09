/*
 * Brand asset gate.
 *
 * The kit is generated from scripts/gen-brand.mjs, which means the checked-in
 * files are outputs and can silently drift — someone edits public/logo.svg by
 * hand, the generator still says something else, and the next regeneration
 * quietly reverts their change. The whole point of the generator is that one
 * geometry definition feeds twelve files; this is what keeps that true.
 *
 * It also guards the two failures that produced the old logo: an icon that only
 * exists at one optical size, and a mark carrying filters that do not survive
 * conversion to .ico.
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { ASSETS, COLOR } from '../../scripts/gen-brand.mjs'

const RASTERS = [
  'brand/favicon-16.png',
  'brand/favicon-32.png',
  'brand/apple-touch-icon.png',
  'brand/icon-512.png',
  'brand/icon-1024-macos.png',
  'brand/og-1200x630.png',
  'brand/repomanager.ico',
  'packaging/windows/assets/repomanager.ico',
  'public/favicon-32.png',
  'public/apple-touch-icon.png',
  'public/og-1200x630.png',
]

describe('brand assets match their generator', () => {
  for (const [rel, expected] of Object.entries(ASSETS)) {
    it(`${rel} is what gen-brand.mjs emits`, () => {
      expect(existsSync(rel), `${rel} is missing — run: node scripts/gen-brand.mjs`).toBe(true)
      expect(
        readFileSync(rel, 'utf8'),
        `${rel} was edited by hand. Change scripts/gen-brand.mjs instead, then regenerate.`
      ).toBe(expected)
    })
  }
})

describe('every raster in the kit exists and is non-empty', () => {
  for (const rel of RASTERS) {
    it(rel, () => {
      expect(existsSync(rel), `${rel} is missing — run: node scripts/gen-brand-raster.mjs`).toBe(true)
      expect(statSync(rel).size).toBeGreaterThan(200)
    })
  }
})

describe('the marks stay renderable everywhere they are used', () => {
  const svgs = Object.keys(ASSETS)

  for (const rel of svgs) {
    it(`${rel} carries no filter, blur or gradient`, () => {
      // These are the exact features that were dropped when the previous logo
      // was converted to .ico, and that turned it to mush below 32 px.
      const body = readFileSync(rel, 'utf8')
      for (const banned of ['<filter', 'feGaussianBlur', 'linearGradient', 'radialGradient', 'filter=']) {
        expect(body, `${rel} contains ${banned}`).not.toContain(banned)
      }
    })
  }

  it('the mono mark really is single-colour', () => {
    // A "mono" file with a hardcoded lime in it silently ignores the host's
    // theme, which is the one thing it exists to respect.
    const mono = readFileSync('brand/mark-mono.svg', 'utf8')
    expect(mono).not.toContain(COLOR.lime)
    expect(mono.match(/currentColor/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('the favicon uses the small cut, because a browser tab is 16 px', () => {
    // Shipping the display cut here is the single most common way to ruin this
    // mark, and it is invisible until someone looks at a real tab.
    const favicon = readFileSync('public/logo.svg', 'utf8')
    expect(favicon, 'favicon must not carry the display cut ring').not.toMatch(/r="7\.6"/)
  })

  it('the display and small cuts are genuinely different artwork', () => {
    const display = readFileSync('brand/mark-display.svg', 'utf8')
    const small = readFileSync('brand/mark-small.svg', 'utf8')
    expect(small).not.toBe(display)
    expect(display, 'display cut should have the ring').toMatch(/r="7\.6"/)
    expect(small, 'small cut must drop the ring').not.toMatch(/r="7\.6"/)
  })
})

describe('the Windows icon carries every slot, with the right cut in each', () => {
  const ico = readFileSync('packaging/windows/assets/repomanager.ico')

  it('is a valid multi-size ICO', () => {
    expect(ico.readUInt16LE(0), 'reserved field').toBe(0)
    expect(ico.readUInt16LE(2), 'type 1 = icon').toBe(1)
    expect(ico.readUInt16LE(4), 'slot count').toBe(6)
  })

  it('covers 16 through 256', () => {
    const sizes = []
    for (let i = 0; i < ico.readUInt16LE(4); i++) {
      // Width is one byte, so 256 is encoded as 0.
      sizes.push(ico.readUInt8(6 + i * 16) || 256)
    }
    expect(sizes).toEqual([16, 24, 32, 48, 64, 256])
  })

  it('stores each slot as a PNG, which is what makes a 256 slot affordable', () => {
    const count = ico.readUInt16LE(4)
    for (let i = 0; i < count; i++) {
      const dir = 6 + i * 16
      const offset = ico.readUInt32LE(dir + 12)
      const length = ico.readUInt32LE(dir + 8)
      expect(length, `slot ${i} is empty`).toBeGreaterThan(100)
      expect(
        ico.subarray(offset, offset + 8).toString('hex'),
        `slot ${i} is not a PNG`
      ).toBe('89504e470d0a1a0a')
    }
  })
})

describe('nothing still points at the retired company icon', () => {
  it('the installer and packaging ship the product mark', () => {
    // bolalabs.ico is the COMPANY flask. Shipping it as the product icon was
    // the conflation docs/BRAND.md exists to end.
    for (const file of [
      'packaging/windows/installer.iss',
      'scripts/package-windows.mjs',
      'index.html',
    ]) {
      expect(readFileSync(file, 'utf8'), `${file} still references bolalabs.ico`)
        .not.toContain('bolalabs.ico')
    }
  })

  it('the retired icon is gone from the tree', () => {
    expect(existsSync('packaging/windows/assets/bolalabs.ico')).toBe(false)
  })
})
