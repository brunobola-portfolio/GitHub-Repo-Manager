# The film, re-scored — and the blockers a stranger would have hit

2026-09-12. Two pieces of work in one pass: the promo film was re-scored, re-
narrated and re-cut after listening notes ("the music is a bit shrill, it
should be softer and more melodic; the cuts only roughly follow it; the voice
does not sit well and cannot be heard"), and two audits — one on the product,
one on the site — were run against what a stranger meets on launch day. Every
number below was measured with `ffmpeg`/`ffprobe` or probed against the live
hosts; nothing here is an estimate.

## 1. The film (v4)

### What was wrong, in numbers

| Measure | v3 | v4 | Why it matters |
| --- | --- | --- | --- |
| Score, integrated loudness | -15.4 LUFS | -20.8 LUFS | v3's bed was 6 dB LOUDER than the narration |
| Score, true peak | 0.0 dBFS | -3.7 dBFS | v3 clipped; clipping is most of "shrill" |
| Score energy above 4 kHz | -42.8 dB | -65.2 dB | the 16th-note shimmer and the 7 kHz hats are gone |
| Score energy in 1-4 kHz | -28.5 dB | -47.1 dB | that band is the voice's now, not the score's |
| Narration line (vo2) | -21.6 LUFS | -19.6 LUFS | and read 31% slower |
| Final mix, integrated | -15.9 LUFS | -13.1 LUFS | the level LinkedIn/X/YouTube normalise towards |
| Final mix, true peak | -0.7 dBFS | -1.5 dBFS | headroom for the platforms' re-encodes |
| Speech vs bed, 1-4 kHz | bed louder | voice +25 dB | this is why the voice could not be heard |

### What changed, and why

- **The cuts are on the beat.** The score runs at 80 BPM (0.75 s a beat, 3 s a
  bar) and every cue in the timeline is a whole number of beats. Scene lengths
  still come from the measured narration: a line is never stretched to fit a
  bar, the bar is chosen to hold the line plus about a second of air. Each cut
  also gets its own downbeat in the score (a low swell and a soft chord tone),
  so picture and music land together.
- **There is a melody now.** A five-note motif walks the current chord's tones
  and returns, with a counter-line an octave below on the second bar of each
  chord. Harmony is i-VI-III-VII in D minor (Dm, B flat, F, C), two bars each.
  v3 had a pad, an arpeggio and a riser — texture, no theme.
- **Warm instead of bright.** Triangles and sines replaced the detuned sawtooth
  pad; the shimmer two octaves up became a bell one octave up, filtered at
  2.4 kHz; the 7 kHz noise hats became a 3.5 kHz shaker at a twentieth of the
  level; the riser stops sweeping at 2.5 kHz instead of 6 kHz; the final chord
  swell is triangles through a 1.4 kHz filter. The whole bus ends in a 7.5 kHz
  low-pass and a 5 kHz shelf cut.
- **A pocket for the voice.** The music bus dips 4 dB at 2.5 kHz — where speech
  lives — and the voice bus is lifted 3 dB at 2.8 kHz to sit in it.
- **A cinematic read.** `en-US-ChristopherNeural` at -4% replaced Andrew, chosen
  on measurements rather than taste: on the same line it is 31% slower and
  carries more presence above 4 kHz. Portuguese stays Duarte, slowed to -8%.
- **A deterministic mix.** The voice bus is de-essed and loudness-normalised to
  a fixed -17 LUFS (v3 multiplied it by a guessed 1.7); the bed sits 9 dB under
  it and ducks at ratio 12 with a 400 ms release (v3: ratio 7); the sum is
  normalised to -14 LUFS at -1.5 dBTP.
- **The light breathes on the beat** while the product is on screen — 12% of the
  glow, and the dust with it.
- **Web copies never upscale.** The first pass resized the 1080x1080 square cut
  up to 1280, making the delivery copies larger and softer than the master they
  came from. Only a long edge above 1280 is resized now.

The film is longer by design, because the read is slower: 81.0 s in English,
77.25 s in Portuguese. Copy that said "one minute" was corrected in the README,
`docs/tour.md` and the site's hero label rather than left to rot.

## 2. What a stranger would have hit

Two audits ran against the shipped product and the live site. The findings that
were fixed in this pass:

### Product

1. **The public box was running `DEPLOYMENT_MODE=self-host`.** Proof: the
   instance-wide webhook endpoint answered 401 (signature check) instead of 410.
   In self-host mode an installed instance licence grants its tier to *every*
   signed-in account, and the shared webhook secret is one key for all tenants.
   Fixed on the box through `ops-iis.yml` → `configure-integrations`; the
   endpoint now answers **410** and the service came back healthy on 4.25.1.
   The guide and the env template now document the variable.
2. **A paid licence key could be silently destroyed.** With
   `EMAIL_PROVIDER=console` the adapter returns ok for mail nobody receives (and
   deliberately does not log the body, because the body is a licence key), so
   the issuer marked the row `email_delivered = 1` for a key the customer never
   got — and no route hands an owner their key back. The issuer now refuses to
   send through the console adapter: the licence is persisted, the row stays
   undelivered, and the log says a key is owed.
3. **The 365-day credential-deletion warning had the same hole** — "sent" to the
   console, user marked as warned, credentials deleted 30 days later with no
   notice. Warnings are now held while mail cannot leave the box; purges still
   run.
4. **"SSO / SAML (coming soon)"** on three paid-tier surfaces became
   "(roadmap)", matching README and ROADMAP, with a ratchet in the pricing
   parity gate so it cannot come back.
5. **The Stripe-missing banner told hosted users they were self-hosted.** The
   deployment mode is not exposed client-side, so the copy now says self-serve
   checkout is not available here yet and offers the contact route — true either
   way.

### Site

1. **Every Pro/Enterprise/demo lead landed silently.** The contact mutation only
   inserted a row; nothing notified anyone. It now schedules an internal action
   that e-mails the owner, HTML-escaped, with the lead as `reply_to`, and
   degrades to a no-op when e-mail is unconfigured. **It takes effect only after
   a Convex production deploy.**
2. **The French Enterprise card promised an SLA** no tier offers; it now says
   assisted migration, like the other three locales.
3. **"Annual billing available at a discount"** was asserted on the pricing card
   and in the FAQ (indexed by Google) while no yearly Stripe price is
   configured. Replaced with a claim that is true on every plan.
4. **The hero video autoplayed several megabytes on phones**, and a
   reduced-motion visitor saw the loop until hydration. A blocking same-origin
   guard script now strips `autoplay`, sets `preload="none"` and aborts the
   fetch under 640 px or when reduced motion is requested.
5. **No `og:video`**, so every launch post rendered a static card. Added, from
   the same object that feeds the hero, so the two cannot drift.
6. **The GitHub repository button** was missing from the closing band on a page
   whose main draw for Show HN is the Apache-2.0 source.
7. **DORA was never explained.** The site named it on the hero, in the
   capability list and on a gallery tile without ever saying what it is. There
   is now a FAQ entry — also emitted as FAQPage structured data — that defines
   DevOps Research and Assessment, lists the four metrics, and says how lead
   time is computed here and what is shown when there is no deployment data.

## 3. Still the owner's to do

- **Resend — done on the product, 2026-09-12.** `EMAIL_PROVIDER=resend`,
  `EMAIL_FROM=Repo Manager <no-reply@bolalabs.pt>`, `ALLOW_CONSOLE_EMAIL`
  removed, and two test messages accepted by Resend (`email-test` action), so
  licence keys, retention warnings and digests can now be delivered. One trap
  worth recording: a key created with *Sending access* cannot read
  `GET /domains` and answers 401 — the action used to refuse the correct key
  for that reason, and no longer does.
- **The site half of e-mail:** the contact-form notification is deployed to
  Convex production but stays a no-op until the key is in Convex's own
  environment — `npx convex env set RESEND_API_KEY "re_…" --prod` in
  `bolalabs-platform`. `EMAIL_FROM` and `CONTACT_NOTIFY_TO` are already set
  there. A session cannot do this step: the key is a GitHub secret and is
  never readable back.
- **Stripe** keys when Pro is to be sold; until then the site's Pro card points
  at the contact form and the app's banner says checkout is not available.
- **Sentry**: data scrubbing and IP storage off, an alert rule, and
  `SENTRY_BROWSER_DSN` on the box (browser reporting is still unset).

Local copies of the launch copy: `docs/reports/2026-09-11-launch-kit.md` (posts
for weeks 1-4, EN and PT). Film pipeline and its measurements:
`.dev/promo/README.md` on the development machine.
