#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.
/*
 * Generates brand/index.html — the visual brand guide and media kit index.
 *
 * It is GENERATED, not written, and that is the whole point. The page embeds
 * the very SVG strings gen-brand.mjs emits and reads its colours from the same
 * COLOR constant, so it cannot drift from the assets it documents. A hand-kept
 * HTML copy would be a second source of truth, which is the failure this repo
 * has spent a lot of effort removing elsewhere.
 *
 *   node scripts/gen-brand-page.mjs
 *   node scripts/gen-brand-page.mjs --check    (CI gate)
 *
 * docs/BRAND.md stays the written spec — the rules, the reasoning, the "never"
 * list. This page is the visual counterpart: it shows the marks at real pixel
 * sizes on both grounds, which prose cannot do.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ASSETS, COLOR } from './gen-brand.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'brand/index.html')

// Absolute, because this page is served from two places with different
// relative roots: opened from a clone at brand/index.html, and served by the
// app at /brand/. Only the zip (a sibling in both) can stay relative.
const REPO = 'https://github.com/brunobola-portfolio/GitHub-Repo-Manager'

// Inline an asset into the page: drop the leading provenance comment (noise in
// HTML) and the fixed width/height (they would fight the CSS that sets each
// instance's real pixel size).
//
// Sliced from the first `<svg`, not comment-stripped with a regex. Every asset
// is emitted as NOTE + <svg> by gen-brand.mjs, so the slice is exact — and a
// single-pass `replace(/<!--...-->/)` is the incomplete-sanitization shape that
// leaves a bare `<!--` behind on nested input. Nothing here takes user input,
// but a fragile helper is a bad thing to leave in a generator someone will copy.
const inline = (key) => {
  const svg = ASSETS[key]
  const start = svg.indexOf('<svg')
  if (start === -1) throw new Error(`${key} does not contain an <svg> root`)
  return svg.slice(start).replace(/\s+width="[\d.]+"\s+height="[\d.]+"/, '').trim()
}

const FONTS = [
  ['Archivo', 'archivo-latin-wght-normal.woff2'],
  ['Plex', 'ibm-plex-sans-latin-wght-normal.woff2'],
  ['JBMono', 'jetbrains-mono-latin-wght-normal.woff2'],
]

/**
 * The favicon as a data URI.
 *
 * A relative href cannot work in both places this page lives: from a clone the
 * favicon sits at ../public/logo.svg, but served from dist/brand/ it is at
 * /logo.svg. Inlining the tile — it is under 700 bytes — makes the page truly
 * self-contained, which is what the gate checks for.
 */
const faviconDataUri = () =>
  'data:image/svg+xml;base64,' + Buffer.from(inline('public/logo.svg'), 'utf8').toString('base64')

/** One rung of the size ladder: the mark at a true pixel size. */
const rung = (key, px, label) =>
  `<div class="rung"><div class="box" style="width:${px}px;height:${px}px">${inline(key)}</div>` +
  `<span class="cap">${label}</span></div>`

const swatch = (name, hex, note) =>
  `<div class="sw"><div class="chip" style="background:${hex}"></div>` +
  `<div class="meta"><div class="n">${name}</div><div class="h">${hex}</div>` +
  `<div class="u">${note}</div></div></div>`

function page() {
  const fileRows = KIT_FILES
    .map((k) => `<tr><td class="mono">${k}</td><td>${DESCRIPTIONS[k]}</td></tr>`)
    .join('\n      ')

  return `<!doctype html>
<html lang="en" data-generated-by="scripts/gen-brand-page.mjs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RepoManager — brand &amp; media kit</title>
<meta name="description" content="The RepoManager mark, its two optical cuts, the inherited BolaLabs palette and type, and every file in the media kit.">
<meta property="og:type" content="website">
<meta property="og:title" content="RepoManager — brand &amp; media kit">
<meta property="og:description" content="The mark at real pixel sizes, the palette, the type, and a downloadable kit.">
<meta property="og:image" content="https://raw.githubusercontent.com/brunobola-portfolio/GitHub-Repo-Manager/main/brand/og-1200x630.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="RepoManager — brand &amp; media kit">
<meta name="twitter:image" content="https://raw.githubusercontent.com/brunobola-portfolio/GitHub-Repo-Manager/main/brand/og-1200x630.png">
<link rel="icon" type="image/svg+xml" href="${faviconDataUri()}">
<style>
${FONTS.map(([fam, file]) => `  @font-face{font-family:"${fam}";src:url(fonts/${file}) format("woff2");font-weight:100 900;font-display:swap}`).join('\n')}

  :root{
    --lime:${COLOR.lime}; --ink:${COLOR.ink}; --paper:${COLOR.paper}; --ground:${COLOR.ground};
    --bg:#FCFCFD; --surface:#F4F5F7; --sunk:#EAECEF; --line:#DFE2E7;
    --text:#0F172A; --muted:#586074; --accent-text:#3f7d12;
    --btn-bg:${COLOR.ground}; --btn-fg:#F8FAFC; --btn-sub:#94A3B8;
  }
  @media (prefers-color-scheme:dark){
    :root:not([data-theme="light"]){
      --bg:#0B0F19; --surface:#131926; --sunk:#1B2231; --line:#252D3E;
      --text:#E6EAF2; --muted:#96A0B5; --accent-text:#8fd23f;
      --btn-bg:#F1F5F9; --btn-fg:${COLOR.ink}; --btn-sub:#4A5468;
    }
  }
  :root[data-theme="dark"]{
    --bg:#0B0F19; --surface:#131926; --sunk:#1B2231; --line:#252D3E;
    --text:#E6EAF2; --muted:#96A0B5; --accent-text:#8fd23f;
    --btn-bg:#F1F5F9; --btn-fg:${COLOR.ink}; --btn-sub:#4A5468;
  }

  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);
    font-family:"Plex",ui-sans-serif,system-ui,sans-serif;font-size:16px;line-height:1.6;
    -webkit-font-smoothing:antialiased}
  .wrap{max-width:820px;margin:0 auto;padding:0 20px 80px}
  .mono{font-family:"JBMono",ui-monospace,monospace;font-size:.92em}
  h1,h2,h3{font-family:"Archivo",ui-sans-serif,sans-serif;letter-spacing:-.025em;
    text-wrap:balance;margin:0}
  h1{font-size:clamp(34px,8vw,54px);font-weight:700;line-height:1.03}
  h2{font-size:clamp(22px,4.4vw,29px);font-weight:650;margin-bottom:10px}
  h3{font-size:16.5px;font-weight:650;margin-bottom:5px}
  p{margin:0 0 15px;max-width:64ch}
  a{color:var(--accent-text)}
  .eyebrow{font-family:"JBMono",monospace;font-size:11px;letter-spacing:.16em;
    text-transform:uppercase;color:var(--muted);margin:0 0 12px}
  section{padding:44px 0;border-top:1px solid var(--line)}
  .hero{padding:56px 0 40px}
  .hero .badge{width:124px;height:124px;margin-bottom:26px}
  .hero .badge svg{width:100%;height:100%;display:block}
  .lede{font-size:17.5px;color:var(--muted)}

  /* Both grounds are FIXED, never themed. These two strips exist to show the
     light-ground and dark-ground variants of the mark, so their backgrounds
     have to stay put — a themed --sunk flips dark in dark mode and renders the
     ink-coloured marks almost invisibly against it. */
  .ladder{display:flex;align-items:flex-end;gap:20px;flex-wrap:wrap;
    border-radius:14px;padding:20px 18px;margin:16px 0;
    background:#FFFFFF;border:1px solid var(--line)}
  .ladder.dark{background:${COLOR.ground};border-color:#252D3E}
  .stripcap{font-family:"JBMono",monospace;font-size:10.5px;letter-spacing:.12em;
    text-transform:uppercase;color:var(--muted);margin:18px 0 -6px}
  .rung{display:flex;flex-direction:column;align-items:center;gap:9px}
  .rung .box svg{width:100%;height:100%;display:block}
  .cap{font-family:"JBMono",monospace;font-size:10px;letter-spacing:.07em;color:#6B7280}
  .ladder.dark .cap{color:#8A94A8}

  /* The download is the only action on the page, so it inverts against the
     ground rather than sitting on a fixed one: ink-on-paper reversed. Filling
     it with the lime would be the obvious move and the wrong one — this page
     argues the lime is spent on the node alone, and a page that breaks its own
     rule in its first screenful is not a spec. */
  .dl{display:inline-flex;flex-direction:column;gap:3px;text-decoration:none;
    background:var(--btn-bg);color:var(--btn-fg);border-radius:13px;padding:15px 22px;
    border:1px solid transparent;transition:border-color .18s cubic-bezier(.2,0,0,1)}
  .dl span{font-size:12.5px;color:var(--btn-sub);font-family:"JBMono",monospace;letter-spacing:.02em}
  .dl:hover{border-color:${COLOR.lime}}
  .dl:focus-visible{outline:3px solid ${COLOR.lime};outline-offset:3px}
  @media (prefers-reduced-motion:reduce){.dl{transition:none}}

  .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
  @media(max-width:620px){.grid3{grid-template-columns:1fr}}
  .sw{border:1px solid var(--line);border-radius:13px;overflow:hidden}
  .sw .chip{height:72px;box-shadow:inset 0 0 0 1px rgb(148 163 184 / .22)}
  .sw .meta{padding:10px 12px;background:var(--surface)}
  .sw .n{font-weight:600;font-size:14px}
  .sw .h{font-family:"JBMono",monospace;font-size:12px;color:var(--muted)}
  .sw .u{font-size:12.5px;color:var(--muted);margin-top:3px}

  .panel{background:var(--surface);border:1px solid var(--line);border-radius:15px;
    padding:18px 16px;text-align:center}
  .panel .t{width:88px;height:88px;margin:0 auto 12px}
  .panel .t svg{width:100%;height:100%;display:block}
  .panel p{font-size:13.5px;color:var(--muted);margin:0;max-width:none}

  .rule{border-left:3px solid var(--lime);padding:2px 0 2px 14px;margin:0 0 14px}
  .rule.no{border-left-color:#DC2626}
  .rule p{margin:0}
  .rule .tag{font-family:"JBMono",monospace;font-size:10.5px;letter-spacing:.1em;
    text-transform:uppercase;color:var(--muted);display:block;margin-bottom:3px}

  .spec{border:1px solid var(--line);border-radius:15px;padding:19px 17px;
    margin-bottom:11px;background:var(--surface)}
  .spec .role{font-family:"JBMono",monospace;font-size:10.5px;letter-spacing:.12em;
    text-transform:uppercase;color:var(--muted);margin-bottom:7px}
  .spec .s{margin:0 0 7px;line-height:1.12;max-width:none}
  .spec .note{font-size:13.5px;color:var(--muted);margin:0;max-width:none}

  table{width:100%;border-collapse:collapse;font-size:14.5px}
  th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-family:"JBMono",monospace;font-size:10.5px;letter-spacing:.1em;
    text-transform:uppercase;color:var(--muted);font-weight:400}
  .scroller{overflow-x:auto;-webkit-overflow-scrolling:touch}
  footer{padding:34px 0 0;border-top:1px solid var(--line);color:var(--muted);font-size:13.5px}
</style>
</head>
<body>
<div class="wrap">

  <div class="hero">
    <div class="badge">${inline('brand/tile-windows.svg')}</div>
    <p class="eyebrow">BolaLabs · RepoManager</p>
    <h1>The commit that<br>wants you.</h1>
    <p class="lede">A rail of commits, and one node lifted off it. The product exists to tell you which repository needs you today — the mark is that sentence, drawn once.</p>
    <p><a class="dl" href="repomanager-media-kit.zip" download>Download the media kit<span>ZIP · every mark, both cuts, the tiles, the fonts and the spec</span></a></p>
    <p style="font-size:14px;color:var(--muted)">Generated from <span class="mono">scripts/gen-brand.mjs</span>, the same file the assets come from — so this page cannot disagree with them. The written spec is <a href="${REPO}/blob/main/docs/BRAND.md">BRAND.md</a>, and it travels inside the kit.</p>
  </div>

  <section>
    <p class="eyebrow">01 · Two optical cuts</p>
    <h2>Never one file scaled down</h2>
    <p>Below about 24&nbsp;px the ring closes into a smudge and a 2.9 stroke lands between pixels. The small cut drops the ring, grows the node and thickens every stroke — same idea, redrawn. This is the difference between an icon and a logo shrunk.</p>

    <p class="stripcap">On a light ground</p>
    <div class="ladder">
      ${rung('brand/mark-display.svg', 64, '64 · display')}
      ${rung('brand/mark-display.svg', 32, '32 · display')}
      ${rung('brand/mark-small.svg', 24, '24 · small')}
      ${rung('brand/mark-small.svg', 16, '16 · small')}
    </div>
    <p class="stripcap">On a dark ground</p>
    <div class="ladder dark">
      ${rung('brand/mark-display-inverse.svg', 64, '64 · display')}
      ${rung('brand/mark-display-inverse.svg', 32, '32 · display')}
      ${rung('brand/mark-small-inverse.svg', 24, '24 · small')}
      ${rung('brand/mark-small-inverse.svg', 16, '16 · small')}
    </div>
    <p style="font-size:14px;color:var(--muted)">The Windows <span class="mono">.ico</span> carries different artwork per slot: small at 16 and 24, display at 32 and above. No generic converter does that.</p>
  </section>

  <section>
    <p class="eyebrow">02 · Colour</p>
    <h2>The house lime, spent in one place</h2>
    <p>RepoManager has no palette of its own. It inherits the official BolaLabs primary and spends it on exactly one element: the attending node. Everything else is ink.</p>
    <div class="grid3" style="margin:18px 0 14px">
      ${swatch('Lime', COLOR.lime, 'The node. Fill only.')}
      ${swatch('Ink', COLOR.ink, 'Structure on light')}
      ${swatch('Ground', COLOR.ground, 'Tile background')}
    </div>
    <div class="rule"><span class="tag">Inherited rule</span>
      <p>The lime is <b>fill only — never text</b>. For a coloured word use <span class="mono">#8fd23f</span> on dark (11:1) or <span class="mono">#3f7d12</span> on light (~5:1).</p></div>
    <div class="rule no"><span class="tag">Collision to avoid</span>
      <p>The product's UI uses green for <em>passing</em>. The brand lime sits at H≈87° and must never mean "healthy", or the brand and the status language start contradicting each other.</p></div>
  </section>

  <section>
    <p class="eyebrow">03 · Typography</p>
    <h2>Three faces, already chosen</h2>
    <p>Inherited from the platform, shipped with this kit under the SIL Open Font Licence — see <span class="mono">brand/fonts/OFL.txt</span>.</p>
    <div class="spec"><div class="role">Display · Archivo</div>
      <p class="s" style="font-family:'Archivo';font-weight:700;font-size:clamp(26px,5.6vw,40px);letter-spacing:-.03em">Manage every repository</p>
      <p class="note">Headlines and the wordmark. 600–700, never below 20&nbsp;px.</p></div>
    <div class="spec"><div class="role">Text · IBM Plex Sans</div>
      <p class="s" style="font-size:18px;line-height:1.5">A rail of commits, and one node lifted off it — the repository that needs you today.</p>
      <p class="note">All running text and UI labels.</p></div>
    <div class="spec"><div class="role">Data · JetBrains Mono</div>
      <p class="s mono" style="font-size:15.5px">git log --oneline · ${COLOR.lime} · 7,099 tests</p>
      <p class="note">Code, versions, hex values, metrics.</p></div>
  </section>

  <section>
    <p class="eyebrow">04 · Installed on a machine</p>
    <h2>Every OS wants a different file</h2>
    <div class="grid3" style="margin-top:18px">
      <div class="panel"><div class="t">${inline('brand/tile-macos.svg')}</div>
        <h3>macOS</h3><p>1024 canvas, art at 824, radius 185.4. macOS does not round for you.</p></div>
      <div class="panel"><div class="t">${inline('brand/tile-windows.svg')}</div>
        <h3>Windows</h3><p>One <span class="mono">.ico</span> carrying 16/24/32/48/64/256.</p></div>
      <div class="panel"><div class="t" style="border-radius:50%;overflow:hidden">${inline('brand/tile-adaptive.svg')}</div>
        <h3>Adaptive</h3><p>Mark at 58% so a circular mask never clips the rail.</p></div>
    </div>
  </section>

  <section>
    <p class="eyebrow">05 · The kit</p>
    <h2>Every file, and what it is for</h2>
    <div class="scroller"><table>
      <tr><th>File</th><th>For</th></tr>
      ${fileRows}
    </table></div>
    <p style="font-size:14px;color:var(--muted);margin-top:14px">Rasters — the <span class="mono">.ico</span>, PNG favicons, apple-touch icon and social card — sit alongside these, built by <span class="mono">scripts/gen-brand-raster.mjs</span>. The three typefaces live in <span class="mono">fonts/</span> with their OFL licence, and <span class="mono">repomanager-media-kit.zip</span> is all of it in one file.</p>
  </section>

  <section>
    <p class="eyebrow">06 · Never</p>
    <h2>What breaks it</h2>
    <div class="rule no"><span class="tag">Never</span><p>Recolour the node. It is the only carrier of brand recognition.</p></div>
    <div class="rule no"><span class="tag">Never</span><p>Add a gradient, glow or shadow. The previous logo had four gradients and three blurs, and that is why it died at 16&nbsp;px and lost detail converting to <span class="mono">.ico</span>.</p></div>
    <div class="rule no"><span class="tag">Never</span><p>Scale the display cut below 25&nbsp;px, or use the mark below 16&nbsp;px.</p></div>
    <div class="rule no"><span class="tag">Never</span><p>Use the BolaLabs flask as the product icon. The flask is the company; the rail is the product.</p></div>
    <div class="rule no"><span class="tag">Never</span><p>Borrow anything from GitHub — Octocat, wordmark or palette. RepoManager <em>manages</em> GitHub and is not affiliated with it.</p></div>
  </section>

  <footer>
    <p style="margin:0 0 12px">RepoManager and the RepoManager mark are assets of Bola&nbsp;Labs,&nbsp;Inc. Use them to refer to the product; do not modify or recolour the mark, and do not use it to imply a partnership that does not exist. RepoManager manages GitHub repositories and is <strong>not</strong> affiliated with, endorsed by or sponsored by GitHub,&nbsp;Inc.</p>
    <p style="margin:0">Generated by <span class="mono">scripts/gen-brand-page.mjs</span>. Do not edit this file — change the geometry in <span class="mono">scripts/gen-brand.mjs</span> and run <span class="mono">npm run gen:brand</span>. Fonts are SIL OFL-1.1; see <span class="mono">fonts/OFL.txt</span>.</p>
  </footer>

</div>
</body>
</html>
`
}

// One line per asset, kept beside the generator so a new asset cannot ship
// undocumented — Object.keys(ASSETS) drives the table, and a missing entry
// renders as "undefined", which the gate catches.
/**
 * The kit is what someone downloads: files under brand/ and the favicon.
 * gen-brand.mjs also emits src/components/ui/BrandMark.jsx — generated for the
 * same anti-drift reason, but a React component is not a media-kit asset and
 * has no business in the file table.
 */
export const KIT_FILES = Object.keys(ASSETS).filter((k) => !k.startsWith('src/'))

const DESCRIPTIONS = {
  'brand/mark-display.svg': 'Bare mark, 25 px and up, light grounds',
  'brand/mark-display-inverse.svg': 'Bare mark, 25 px and up, dark grounds',
  'brand/mark-small.svg': 'Bare mark, 24 px and below',
  'brand/mark-small-inverse.svg': 'Bare mark, 24 px and below, dark grounds',
  'brand/mark-mono.svg': 'Single colour — structure and node both currentColor',
  'brand/lockup-horizontal.svg': 'Mark + wordmark, side by side',
  'brand/lockup-horizontal-inverse.svg': 'Horizontal lockup for dark grounds',
  'brand/lockup-stacked.svg': 'Mark above wordmark',
  'brand/tile-macos.svg': '824 art in a 1024 canvas, radius 185.4, pre-rounded',
  'brand/tile-windows.svg': '256 square, radius 30',
  'brand/tile-adaptive.svg': 'Mark at 58% so a circular mask never clips it',
  'public/logo.svg': 'Favicon and app mark — the small cut, because a tab is 16 px',
}

function write() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, page())
  console.log(`Wrote brand/index.html (${(page().length / 1024).toFixed(0)} KB).`)
}

function check() {
  const norm = (s) => s.replace(/\r\n/g, '\n')
  if (!fs.existsSync(OUT)) {
    console.error('brand/index.html is missing. Run: node scripts/gen-brand-page.mjs')
    process.exit(1)
  }
  if (norm(fs.readFileSync(OUT, 'utf8')) !== norm(page())) {
    console.error('brand/index.html is out of sync with scripts/gen-brand-page.mjs.')
    console.error('Run: node scripts/gen-brand-page.mjs')
    process.exit(1)
  }
  console.log('brand: index.html matches the generator.')
}

export { page, DESCRIPTIONS }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.argv.includes('--check') ? check() : write()
}
