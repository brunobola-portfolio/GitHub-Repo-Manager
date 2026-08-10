# Brand — RepoManager

The mark, the rules that keep it working, and where every file goes.

RepoManager is a **BolaLabs** product. It does not have its own palette or its
own typefaces — it inherits the house system and adds one mark. If you are
changing anything here, change it in
[`scripts/gen-brand.mjs`](../scripts/gen-brand.mjs) and regenerate; the assets
are outputs, not sources.

```bash
npm run gen:brand          # SVGs, rasters, and the visual guide
npm run gen:brand:check    # what CI runs
```

> **The visual guide is [`brand/index.html`](../brand/index.html)** — the marks
> at real pixel sizes on both grounds, the palette, the type, and a download
> for the whole kit. Self-contained: it opens straight from a clone with no
> server, and it is generated from the same constants as the assets, so it
> cannot drift from what it documents.
>
> **Where to send someone.** The app serves it at **`/brand`** on any
> deployment — `https://repomanager.bolalabs.pt/brand` once that host is live —
> because `vite.config.js` copies `brand/` into `dist/` at build time and
> `server/index.js` routes it ahead of the SPA fallback. No separate hosting,
> no GitHub Pages. Settings → About links to it in-app.

---

## The name

Two forms are in use and both are correct:

- **GitHub Repo Manager** — the full product name. Used in the README title,
  the package metadata, the installer and anywhere the product is introduced to
  someone who has not met it.
- **RepoManager** — the short form. Used in the wordmark, the lockups, the OG
  card and running text once the full name has been established.

They are not competing names and neither is being retired. If that ever
changes, it changes here first — a media kit that quietly renames a product is
how a brand ends up with two identities in the wild.

---

## The mark

A commit rail with one node lifted off it and ringed. The rail is a git history;
the two terminals are commits; the node is the repository that needs you today.

The asymmetry is the idea, not a compositional accident. Application marks are
almost always centred; this one puts its weight to one side because the product
exists to **point at something**.

### Two optical cuts, never one file scaled

| Cut | Used at | What changes |
| --- | ------- | ------------ |
| **Display** | 25 px and up | Full mark: rail, terminals, node, ring |
| **Small** | 24 px and below | Ring dropped, node grown, strokes thickened, terminals absorbed into the round caps |

Below about 24 px the ring closes into a smudge and a 2.9 stroke lands between
pixels. Shipping the display cut at 16 px is the single most common way to ruin
this mark — it is what the previous logo did, and why it read as a violet square
in a browser tab.

The Windows `.ico` therefore carries **different artwork per slot**:
small at 16 and 24, display at 32 and above. No generic SVG-to-ICO converter
does this; `scripts/gen-brand-raster.mjs` assembles the container itself for
exactly that reason.

### Geometry

A 32-unit grid. The ink is centred on (16,16) and fills roughly 74% of the box
in both cuts. Anything drawn against this mark uses the same grid and the same
stroke weight.

---

## Colour

| Token | Value | Use |
| ----- | ----- | --- |
| Lime | `#7fc528` | The node. The one carrier of brand recognition. |
| Ink | `#0f172a` | Mark structure on light grounds |
| Paper | `#f8fafc` | Mark structure on dark grounds |
| Ground | `#020617` | Tile background |

The lime is the official BolaLabs primary (`--color-primary-500` in the
platform's `index.css`), inherited rather than re-picked.

**Two rules come with it, from the house spec:**

- **The lime is fill only — never text.** For a coloured word or link use
  `#8fd23f` on dark (11:1) or `#3f7d12` on light (~5:1). Both tokens already
  exist upstream; do not invent a third.
- **Colour is never the only signal.** Anything the lime marks also carries a
  shape or a label.

### In the product

The app carries ONE accent ramp, `brand-*`, defined in `src/index.css`. It
replaced indigo, violet and purple, which had been used interchangeably for the
same job while the mark was lime — three accent hues and a logo that shared
none of them.

Every step is luminance-matched to the Tailwind indigo step it replaced, to
within 0.003. That is what let ~1,650 call sites move without re-checking a
single pairing. Two steps are anchored to the literals this document names
rather than to the curve: **300 is `#8fd23f`** and **600 is `#3f7d12`**, the two
sanctioned coloured-word values above.

The lime is deliberately *not* in that ramp. It is 2.12:1 under white, and a
filled button needs 4.5. The lime lives in `--ds-brand-lime` for the mark, and
in `--ds-badge-brand-*` where it appears the one way the spec allows: as a fill,
under ink (8.43:1).

Three rules come with the ramp, all test-enforced
(`tests/build/no-off-brand-palette.test.js`):

- **No retired accent utility.** `indigo-*`, `violet-*`, `purple-*`,
  `fuchsia-*`, `sky-*`, `cyan-*`, `pink-*`, `teal-*` are gone. Use `brand-*`.
- **White on a brand fill is never dimmed.** `text-white/90` measures 4.43:1 on
  `--ds-accent-brand`. It read as harmless softening under indigo, where the
  base was 6.29 and had headroom; the brand green's base is 5.06 and does not.
- **Status colour is not decoration.** `emerald` / `amber` / `rose` / `slate`
  stay, because they mean passing / attention / failing / neutral. Colour used
  to tell two cards apart is what the one ramp replaced. The per-language chart
  colours in `src/utils/languageColors.js` are categorical data and are exempt.

The mark itself is generated into the app the same way the SVGs are:
`scripts/gen-brand.mjs` emits `src/components/ui/BrandMark.jsx`, which picks its
own optical cut from the requested size. Never draw the mark in a component.

---

### The collision to keep in mind

RepoManager's own UI uses green for *passing* and amber for *needs attention*
(`ds-risk-*`, see [AGENTS.md](../AGENTS.md)). The brand lime sits at H≈87° —
yellow-green — and **must never be used to mean "healthy"** inside the product,
or the brand and the status language start contradicting each other. Brand lime
marks the product; semantic green marks a passing check.

---

## Typography

Inherited from the platform. Not re-chosen here.

| Role | Face | Use |
| ---- | ---- | --- |
| Display | **Archivo** | Headlines, the wordmark. 600–700, never below 20 px |
| Text | **IBM Plex Sans** | All running text and UI labels |
| Data | **JetBrains Mono** | Code, versions, hex values, metrics |

The lockup SVGs use live `<text>` in Archivo rather than outlines — this
repository has no font-outlining tool, and a wrong-metrics fake would be worse
than a documented fallback. **Before sending a lockup to print or to a third
party, convert the text to outlines.**

---

## Files

Everything in `brand/` is generated. Nothing in it should be edited by hand.

| File | For |
| ---- | --- |
| `mark-display.svg` / `-inverse` | Bare mark, 25 px and up, light / dark grounds |
| `mark-small.svg` / `-inverse` | Bare mark, 24 px and below |
| `mark-mono.svg` | Single colour — structure and node both `currentColor` |
| `lockup-horizontal.svg` / `-inverse` | Mark + wordmark, side by side |
| `lockup-stacked.svg` | Mark above wordmark |
| `tile-macos.svg` | 824 art in a 1024 canvas, radius 185.4, pre-rounded |
| `tile-windows.svg` | 256 square, radius 30 |
| `tile-adaptive.svg` | Mark at 58% so a circular mask never clips it |
| `repomanager.ico` | 16/24/32/48/64/256, correct cut per slot |
| `favicon-16.png`, `favicon-32.png` | Raster favicon fallbacks |
| `apple-touch-icon.png` | 180 px |
| `icon-512.png`, `icon-1024-macos.png` | Store and bundle art |
| `og-1200x630.png` | Social card |
| `index.html` | The visual guide — open it in a browser, or visit `/brand` |
| `repomanager-media-kit.zip` | The whole kit in one file, with `BRAND.md` and a `README.txt` inside |
| `fonts/*.woff2` + `fonts/OFL.txt` | Archivo, IBM Plex Sans, JetBrains Mono, under SIL OFL-1.1 |

Served copies live in `public/` (`logo.svg`, `favicon-32.png`,
`apple-touch-icon.png`, `og-1200x630.png`) so Vite ships them in `dist/`. The
installer reads `packaging/windows/assets/repomanager.ico`.

---

## Never

- **Recolour the node.** It is the only thing carrying brand recognition.
- **Add a gradient, glow or drop shadow.** The previous logo had four gradients
  and three Gaussian blurs; that is why it died at 16 px and lost detail
  converting to `.ico`.
- **Set the lime as text**, or on a ground giving less than 3:1.
- **Scale the display cut below 25 px.** Use the small cut.
- **Place the mark closer than one node-diameter to another element**, or use
  it below 16 px.
- **Use the BolaLabs flask as the product icon.** The flask is the company; the
  rail is the product. The installer used to ship `bolalabs.ico` and that was
  the conflation this system exists to end.
- **Borrow anything from GitHub** — Octocat, wordmark, or palette. RepoManager
  *manages* GitHub and is not affiliated with it. Implying otherwise in a media
  kit is a trademark problem, not a style one.

---

## Regenerating

`scripts/gen-brand.mjs` holds the geometry as constants and emits every SVG
from them, so a change to the mark propagates to all twelve files at once. The
raster script then re-renders the PNGs and rebuilds the `.ico`.

`tests/build/brand-assets.test.js` fails if the checked-in SVGs drift from the
generator, if a raster is missing, or if the `.ico` loses a slot — so a
half-finished change cannot merge.
