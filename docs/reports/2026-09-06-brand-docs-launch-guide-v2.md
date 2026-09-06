# Brand, docs and launch — the plan, second pass

Date: 2026-09-06 (evening). Supersedes the morning guide
`2026-09-06-brand-seo-social-guide.md` for planning; that file stays as the
record of what was applied and verified in the morning. This pass adds the
promo film with sound, folds the afternoon fixes in, and rewrites the brand,
documentation and outreach plan around one anchor asset instead of a list of
parallel chores.

## 1. What exists now

### The film

`GitHub Repo Manager — 38 seconds`, 1920×1080, 30 fps, stereo sound. Built
in this repository under `.dev/promo/` from a deterministic timeline
(`promo.html`: every frame is a function of time), stepped by Playwright,
scored and voiced offline, assembled by ffmpeg. No stock footage, no stock
music, no licence to track: the score is synthesised in the Web Audio API,
the narration is Microsoft Edge's neural voice, the captures are the
product's own screenshots from `docs/images/` plus one fresh capture of the
migration wizard.

| File (`.dev/promo/`) | Purpose |
| --- | --- |
| `repomanager-promo-1080p.mp4` | Master, 11.7 MB. LinkedIn, X, YouTube, the site hero (H.264 CRF 17 + AAC 192 kbps, 48 kHz) |
| `repomanager-promo-1080p.webm` | Site `<video>` first source, 4.9 MB (VP9 + Opus) |
| `repomanager-promo-720p-preview.mp4` | Review copy for chat and e-mail, 3.3 MB |
| `repomanager-promo-poster.jpg` | `poster` attribute, YouTube thumbnail, 16:9 card, 69 KB |
| `music.wav`, `sfx.wav`, `vo1..6.mp3` | Stems, so a re-cut never re-records |
| `frames/` | 1155 PNG frames; any still is a social image |

Storyboard, with the narration cue and the caption that lands on screen:

| Time | Scene | Voice | Caption |
| --- | --- | --- | --- |
| 0.0–2.9 s | Mark, wordmark word by word, lime rule | — | The repository that needs you. |
| 2.4–9.9 s | Kinetic type on the ground, slow push | Dozens of repositories. Three notification systems. One question every morning: what needs me? | **What needs me?** |
| 9.4–17.3 s | Dashboard (dark) arrives on a 3-D tilt, light sweep, camera settles on the attention row | GitHub Repo Manager puts it on one dashboard. Reviews, stale pull requests, issues — for you, today. | 01 · One dashboard. Reviews, stale PRs, issues — for you, today. |
| 16.8–21.9 s | Work Board | See every repository at once, with DORA metrics built in. | 02 · Every repository at once. DORA metrics included. |
| 21.4–27.3 s | AI insights, 92/100 | AI that reads the code and cites it. Your key. It never auto-commits. | 03 · AI that reads the code and cites it. Your key. Never auto-commits. |
| 26.8–32.1 s | Migration wizard, Connect step; riser under it | Leave Azure DevOps and TFVC, with a dry run first. | 04 · Leave Azure DevOps and TFVC — dry run first. |
| 31.6–38.5 s | Hit, lime flash, lockup, three badges, URL typed | Free. Open source. Native on Windows. The repository that needs you. | repomanager.bolalabs.pt · A BolaLabs product |

Sound design: 96 BPM in D minor; pad and sub from the first frame, kick,
hat and a shimmer arpeggio from the moment the product appears (9.4 s), a
noise riser under the migration scene, one hit on the lockup. Whooshes on
every cut, a tick when each caption lands. The music ducks 7:1 under the
voice through a sidechain compressor, so the narration is always the
loudest thing in the mix; a limiter holds the sum at −0.6 dBFS.

To change anything: edit copy or timings in `promo.html` (the `scenes`
table and the cue list), lines in `voice.mjs`, cue times in `music.html`,
then

```text
node voice.mjs            # six narration MP3s (needs network, Edge TTS)
node render.mjs audio     # music.wav + sfx.wav
node render.mjs frames    # frames/0000..1154.png (about 20 minutes)
node mix.mjs              # MP4, WebM, 720p preview, poster
```

Every step is deterministic except the voice; keep the MP3s under the same
names and a re-render reproduces the film bit for bit.

### The afternoon fixes (4.24.6 → 4.24.8, in production)

- Landing hero captures were silently missing from the deploy (`*.jpg` is
  gitignored); tracked with an exception and a build gate.
- Demo-mode copy said "not available" where it meant "not simulated";
  corrected, test updated.
- A fresh AI overview capture in the current palette replaces the last
  purple-era screenshot; README and `docs/screenshots.md` captions follow.
- `npm run smoke:prod` — forty read-only checks against the public origin
  (shell, headers, canonical, card image, JSON-LD, robots, sitemap, auth
  redirect, API shape). Runs after every release; 40/40 today.

### Shipped in the evening pass

- **Site 1.3.10, live.** The film plays in the `/repomanager` hero in all
  four locales: muted loop in the capture frame, poster fallback,
  `prefers-reduced-motion` honoured, one button that restarts it with sound
  and English captions (`components/ui/HeroVideo.tsx`). The video markup is
  emitted as literal HTML so `muted` survives prerendering (React drops it
  on the server, which blocks autoplay before hydration) and memoised so a
  parent update never recreates the element mid-play. IIS gained `.webm`,
  `.mp4` and `.vtt` MIME maps; the deploy and dist verifiers know the
  three extensions. Verified in production: the WebM answers
  `video/webm`, the prerendered page carries the `<video>`.
- **Product 4.24.9, in production.** `docs/tour.md` (storyboard, a still
  per scene, the guide behind every claim), `docs/guides/first-five-minutes.md`,
  the screenshot policy in `docs/screenshots.md`, the README link to the
  film, and the landing hero's `reveal` motion variant (rise out of a soft
  blur, the film's own arrival).
- **Film variants.** Portuguese 16:9 (Duarte, 44 s, on its own cue table
  because the lines run longer), 1:1 and 9:16 English cuts with the caption
  under the shot, SRT and WebVTT subtitles for both languages, and fifteen
  social cards cut from the frames (title, question, lockup × 1200×630,
  1280×640, 1920×1080, 1200×1200, 1080×1920). Pipeline: `timeline.mjs`
  holds the cues; `render.mjs`, `mix.mjs`, `subs.mjs` and `cards.mjs` take
  `<format> <lang>`.
- **Dependencies.** The high Dependabot alert (browserslist, dev-only)
  closed by merging #339 after a rebase; #342 (sixteen dev-dependency
  minors) fails lint, tests and build on its own and stays open.

## 2. Brand plan — one anchor, then everything matches it

The film is now the reference for how the brand moves and sounds. Every
other surface should read as a still from it. In order:

1. **Motion vocabulary in the app (S).** The film's three moves — blur-cut
   between scenes, word-by-word type arrival, a lime rule that draws in — map
   directly onto `src/components/ui/motion.js`. The landing already uses the
   drift loop; add `reveal` (blur 10 px → 0, 34 px rise, 550 ms) and use it
   on the hero headline and the four feature cards. One variant, reused.
2. **Typefaces (M, unchanged from v1, now urgent).** The film is set in
   Archivo, IBM Plex Sans and JetBrains Mono because `docs/BRAND.md` says
   so. The app still ships Mona Sans. Swap in `src/design-system.css`, ship
   the woff2 from `public/fonts/`, re-run the axe gate. Until this lands,
   the film and the product it opens do not look like the same thing.
3. **Card system from the film's frames (S).** The poster frame, the
   "What needs me?" frame and the lockup frame are the three social images;
   export 1200×630, 1280×640 (GitHub preview), 1200×1200 and 1080×1920 from
   `frames/` with one ffmpeg crop each. Retire the fallback-font PNG in
   `brand/og-1200x630.png` once the raster generator embeds Archivo.
4. **Name form (decision).** The film says "GitHub Repo Manager" in voice
   and "RepoManager" in the lockup — the two sanctioned forms. "Repo
   Manager" (two words) still appears in the app header, the landing nav and
   across the site. Decide, then gate with `tests/build/brand-naming.test.js`.
5. **Shared tokens (M).** `brand/tokens.json` from the generator; site and
   app cite it. The film's lime is `#7fc528` fill and `#9bdc4c` text on the
   dark ground, which is the site's pair, not the app's.
6. **Sound mark (S, optional).** The final hit plus the two-note arpeggio
   tail is 1.4 s; export it as `brand/sound-mark.wav` and reuse it on every
   future cut so the audio is as recognisable as the mark.

## 3. Documentation plan — show, then tell

1. **README fold (M).** Poster image linked to the film (GitHub does not
   embed MP4 from a repository reliably; host on YouTube unlisted or on the
   site and link the poster), then one 100-word paragraph, then Quick Start.
   Move the AI-provider table and OAuth-scope prose to the docs they
   duplicate. Every honesty-gated fact stays.
2. **A tour page (S).** `docs/tour.md`: the film, then the seven stills in
   storyboard order with one sentence each and the link into the matching
   guide. Linked from `docs/index.md` as the first entry.
3. **First five minutes (S).** Connect GitHub → add an AI key → track
   repositories → run a migration dry run. Pure aggregation, linked from
   README Quick Start.
4. **Screenshots policy (S).** `docs/screenshots.md` already states the
   1920×1080 rule; add "captured from mock mode, dark theme first, no
   purple-era captures" and a checklist to refresh captures on any palette
   change. The film reads its captures from `docs/images/`, so a stale
   screenshot now also means a stale film.
5. **Two `/insights` articles (M).** "Migrating TFVC to Git without losing
   history" and "DORA metrics from GitHub alone". The blog pipeline is
   built and empty; the first article unlocks the sitemap entry.
6. **Migration landing page (M).** `repomanager/azure-devops-migration` in
   four locales with the wizard capture and the film's migration scene as a
   6 s loop. The largest search lever the site has.

## 4. Outreach roadmap — four weeks, one film, many cuts

The film is the launch asset; each week re-uses a scene rather than
producing something new.

| Week | Theme | Film use | Where |
| --- | --- | --- | --- |
| 1 | Launch | Full 38 s, native upload (never a link) | LinkedIn, X, Bluesky; YouTube unlisted for the README; Show HN and Product Hunt with the poster and the GitHub link |
| 2 | Work Board and DORA | 12 s cut: scenes 01–02 | LinkedIn carousel of three stills + the cut; r/devops with the DORA framing |
| 3 | AI review and the BYOK stance | 9 s cut: scene 03, captioned | LinkedIn, X; Dev.to article with the still |
| 4 | Migration | 9 s cut: scene 04 plus the close | r/azuredevops, LinkedIn; migration landing page goes live the same day |

Cuts from the same pipeline, all produced in the evening pass:

- 1:1 (1080×1080) and 9:16 (1080×1920) English versions: same timeline,
  the shot stacked over the caption. Feeds and Shorts autoplay these; the
  16:9 file gets letterboxed and loses the caption.
- Subtitles: SRT and WebVTT for English and Portuguese, timed from the
  measured narration. Upload as a track on YouTube; burn into the social
  cuts when a platform strips tracks. Most feeds play muted.
- Portuguese narration (Duarte) as a 44-second 16:9 film; square and tall
  Portuguese cuts are one render each when needed.

Rules that stay from the morning plan: two posts a week, EN and PT, never
per changelog entry; one framing per community, never the same text on
Reddit and HN; name the two honest limits (BYOK only, native installer is
Windows-only); the founder answers comments for the first hours of launch
day; measure with the site's cookieless analytics plus GitHub Traffic and
a weekly star count; retro at the end of week 4 before a second push.

## 5. Decisions only the owner can take

1. **The launch posts.** The film is live on the site; nothing has been
   posted on any channel. Week 1 of §4 starts when you say so.
2. **Voice.** Andrew (en-US) and Duarte (pt-PT) narrate the current cuts.
   Alternatives are one command away: Brian or Christopher (warmer), Ava or
   Emma (female); Raquel for Portuguese.
3. **Product name form** (§2 item 4) and **typeface swap** (§2 item 2).
4. **Default locale of the site** (root and `x-default` point at `/pt/`).
5. **Testimonial policy**: none yet, never fabricated; say so in `AGENTS.md`.

## 6. Rules that came out of this pass

- A promo built from `docs/images/` is a documentation artefact: when a
  capture is refreshed, re-render the film in the same change.
- Narration first, timeline second. Measure each voice file and place the
  cuts on the measured durations; never stretch the voice to fit a scene.
- Voice-over is the one non-deterministic step; keep the MP3s and treat
  them as source.
- Shell heredocs on this machine mangle files with quotes and backticks;
  write generated HTML and scripts through the editor tools, never through
  `cat <<EOF`.
