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
import { page, DESCRIPTIONS, KIT_FILES } from '../../scripts/gen-brand-page.mjs'
import { buildKit } from '../../scripts/gen-brand-kit.mjs'
import AdmZip from 'adm-zip'

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

// Line endings are normalised before comparing. The generator writes LF, but a
// Windows checkout with core.autocrlf=true hands back CRLF — which made this
// gate pass on the Linux CI runner and fail on a developer machine, for a
// difference no renderer can see. .gitattributes pins these files to LF so it
// should not happen; normalising here means a misconfigured clone reports the
// real problem (edited artwork) rather than twelve false alarms.
const sameContent = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n')

describe('brand assets match their generator', () => {
  for (const [rel, expected] of Object.entries(ASSETS)) {
    it(`${rel} is what gen-brand.mjs emits`, () => {
      expect(existsSync(rel), `${rel} is missing — run: node scripts/gen-brand.mjs`).toBe(true)
      expect(
        sameContent(readFileSync(rel, 'utf8'), expected),
        `${rel} was edited by hand. Change scripts/gen-brand.mjs instead, then regenerate.`
      ).toBe(true)
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

describe('the visual guide is generated, not maintained', () => {
  it('brand/index.html matches scripts/gen-brand-page.mjs', () => {
    // A hand-kept HTML brand guide is a second source of truth, and it drifts
    // from the assets it documents. This one embeds the very SVG strings the
    // generator emits, so drift is only possible if someone edits the output.
    expect(existsSync('brand/index.html')).toBe(true)
    expect(
      sameContent(readFileSync('brand/index.html', 'utf8'), page()),
      'brand/index.html was edited by hand. Change scripts/gen-brand-page.mjs and run npm run gen:brand.'
    ).toBe(true)
  })

  it('every asset in the kit is described on the page', () => {
    // Object.keys(ASSETS) drives the file table, so a new asset added without a
    // description would render the literal string "undefined" to a reader.
    for (const key of KIT_FILES) {
      expect(DESCRIPTIONS[key], `${key} has no description in gen-brand-page.mjs`).toBeTruthy()
    }
  })

  it('ships the typefaces it specifies, with their licence', () => {
    // The page names Archivo, IBM Plex Sans and JetBrains Mono. Without the
    // files it renders in a fallback and demonstrates the opposite of its own
    // typography section — and OFL-1.1 requires the licence to travel with them.
    for (const f of [
      'brand/fonts/archivo-latin-wght-normal.woff2',
      'brand/fonts/ibm-plex-sans-latin-wght-normal.woff2',
      'brand/fonts/jetbrains-mono-latin-wght-normal.woff2',
    ]) {
      expect(existsSync(f), `${f} is missing`).toBe(true)
      expect(statSync(f).size).toBeGreaterThan(10_000)
    }
    const ofl = readFileSync('brand/fonts/OFL.txt', 'utf8')
    expect(ofl).toMatch(/SIL Open Font License/i)
    for (const name of ['archivo', 'ibm-plex-sans', 'jetbrains-mono']) {
      expect(ofl, `${name} licence text is missing`).toContain(name)
    }
  })

  it('is self-contained — no external font, script or style', () => {
    // It has to open straight from a clone, offline, with no CDN.
    const html = readFileSync('brand/index.html', 'utf8')
    expect(html).not.toMatch(/https?:\/\/[^"')\s]+\.(woff2?|css|js)/)
    expect(html).not.toContain('<script')
  })
})

describe('the media kit is downloadable and complete', () => {
  const { entries } = buildKit()

  it('the archive exists and is not a stale husk', () => {
    expect(existsSync('brand/repomanager-media-kit.zip')).toBe(true)
    expect(statSync('brand/repomanager-media-kit.zip').size).toBeGreaterThan(100_000)
  })

  it('carries every mark, the fonts, the licence and the spec', () => {
    // Someone receiving this file gets no follow-up email. If the spec or the
    // licence is missing, the rules and the OFL obligation travel nowhere.
    for (const required of [
      'mark-display.svg', 'mark-small.svg', 'mark-mono.svg',
      'tile-macos.svg', 'tile-windows.svg', 'tile-adaptive.svg',
      'repomanager.ico', 'og-1200x630.png',
      'fonts/OFL.txt', 'BRAND.md', 'README.txt',
    ]) {
      expect(entries, `${required} is missing from the media kit`).toContain(required)
    }
  })

  it('is reproducible — regenerating it does not churn the diff', () => {
    // adm-zip stamps entries with the wall clock by default, which would make
    // every `npm run gen:brand` rewrite 220 KB of binary for no change.
    const stamps = new Set(
      new AdmZip(readFileSync('brand/repomanager-media-kit.zip'))
        .getEntries().map((e) => e.header.time.getTime()),
    )
    expect(stamps.size, 'entries carry differing timestamps').toBe(1)
    expect(new Date([...stamps][0]).getFullYear()).toBe(1980)
  })

  it('does not contain the page or a copy of itself', () => {
    expect(entries).not.toContain('index.html')
    expect(entries).not.toContain('repomanager-media-kit.zip')
  })

  it('the page offers it for download', () => {
    expect(readFileSync('brand/index.html', 'utf8')).toContain('href="repomanager-media-kit.zip"')
  })
})

describe('the guide is reachable from the app it belongs to', () => {
  it('the server serves /brand explicitly, ahead of the SPA fallback', () => {
    // express.static runs with index:false so '/' reaches the SPA fallback,
    // which means '/brand/' would be swallowed by it without this route.
    const server = readFileSync('server/index.js', 'utf8')
    const brandRoute = server.indexOf("app.get(['/brand', '/brand/']")
    const spaFallback = server.indexOf("app.get('/{*splat}'")
    expect(brandRoute, 'no /brand route').toBeGreaterThan(-1)
    expect(brandRoute, '/brand must be registered before the SPA fallback')
      .toBeLessThan(spaFallback)
  })

  it('the build copies the kit into dist', () => {
    expect(readFileSync('vite.config.js', 'utf8')).toContain('copy-brand-kit')
  })

  it('Settings links to it', () => {
    expect(readFileSync('src/components/Settings/AboutSection.jsx', 'utf8'))
      .toContain('href="/brand/"')
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
