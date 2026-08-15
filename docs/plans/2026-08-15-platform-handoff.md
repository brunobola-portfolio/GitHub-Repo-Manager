# Handoff to the platform session

**For:** the Claude session working in `D:\Implementacoes\bolalabs-platform`
**From:** the session working in `D:\Implementacoes\Git Hub Repo Manager`
**Date:** 15 August 2026 · **App version at handoff:** v4.19.0

Paste the brief below into that session. Everything in it was verified against
the platform's own source on this machine, not guessed from the deployed site.

---

## Context

The two products ship together. The app is `repomanager.bolalabs.pt`, served by
the same IIS box as `bolalabs.pt`. The full cross-repo picture, with evidence,
is in [`2026-08-14-saas-launch-alignment.html`](2026-08-14-saas-launch-alignment.html)
— open it, it is the shared map.

Three things changed on the app side that the site now contradicts.

---

## 1. The licence is Apache-2.0, not AGPL

Shipped in **v4.19.0**. AGPL-3.0-only is gone.

The commercial licence used to sell one thing: escape from copyleft. Apache-2.0
has no copyleft, so that product no longer exists and is no longer sold. What a
subscription buys is unchanged — headroom, hosting, support, compliance
deliverables — because it never described legal permissions.

**Three site surfaces state the old licence.** All in the local source:

| Where | Says now | Should say |
|---|---|---|
| Product page hero badge | `V4.4 · OPEN-CORE (AGPL-3.0)` | `V4.19.0 · OPEN SOURCE (APACHE-2.0)` |
| ProofBand / facts strip | `AGPL-3.0 open-core + comercial` | `Apache-2.0 + subscrição` |
| `downloads.repomanager.license` | `AGPL-3.0 (Community) + commercial` | `Apache-2.0 + subscrição` |
| Enterprise plan bullet | «licença comercial **sem copyleft**» | drop it — there is no copyleft to be without. Replace with something real: SLA, suporte prioritário, registos de auditoria, 100 chaves de API |

Wording that is accurate now: *"Código aberto sob Apache-2.0 — usar, modificar,
integrar e redistribuir, sem copyleft e sem custo. O nome e a marca continuam
reservados."*

Reference: [`TRADEMARKS.md`](../../TRADEMARKS.md) and
[`LICENSE-COMMERCIAL.md`](../LICENSE-COMMERCIAL.md), which is now a subscription
agreement and opens by saying nothing on it is required to use the software.

The **AITOOL** precedent on the same site is the right model and needs no
change: MIT (Community) + commercial/white-label/OEM, price case by case.

---

## 2. The plan limits are wrong, in four languages

`src/LanguageContext.tsx`, in two places each (the plan blurb and the FAQ
answer). Every tier understates the product. Source of truth:
`server/lib/feature-flags.js` in the app repo.

| Tier | Site says | Product does |
|---|---|---|
| **Free** | 200 repos · 200 IA/mês · 3 equipas · 5 chaves | **∞** repos · **1.000** IA · **∞** equipas · **25** chaves |
| **Pro** | 5.000 IA · equipas até 15 membros | **10.000** IA · membros **∞** · **50** chaves |
| **Enterprise** | 50 chaves | **100** chaves |

Prices are right ($0 / $19 / sob consulta). Only the limits.

Note the repo cap in particular: `feature-flags.js` says in a comment that it
*«was advertised as Free's ceiling… Retracted rather than enforced»* — it was
removed for being false, and the site still advertises it.

---

## 3. The site already says the app is live

This is the one that decides the order of everything else. In the local source,
before any deploy:

```
components/Navbar.tsx:82   { segment: 'repomanager', meta: REPOMANAGER_HOST, live: true }
                           → pulsing green dot in the products menu, beside arcva.pt
src/site.ts                "em produção desde 2026-08-08 … reverse-proxy para 127.0.0.1:3001"
pages/RepoManager.tsx      REPOMANAGER_APP_URL used in two CTAs
docs/LAUNCH.md §5.2        "✅ Live since 2026-08-08"
```

And the probe, today: `GET /api/health`, `/brand` and `/does-not-exist` all
return the same static placeholder, 200. There is no Node process and no proxy.

**So: do not deploy the site before the app is up.** Publishing first turns a
silence into an active claim — a live dot and two buttons pointing at a
placeholder. Sequence in §5 below.

---

## 4. Two small ones

- **`npm run versions --write`** — the tool exists and nobody has run it.
  `PRODUCT_VERSIONS.repomanager` says `4.12.0` locally and the deployed build
  shows `4.4`; the product is on **4.19.0**. Make it part of the release ritual.
- **The FAQ** answers *«A aplicação está disponível já, hospedada?»* with
  *«Ainda não»*. True today, false the minute the app lands.

---

## 5. The order

1. **Platform session, now, without publishing:** the plan limits (§2), the
   licence surfaces (§1), `npm run versions --write` (§4).
2. **App side:** already done — Apache-2.0 and `deploy/iis/deploy.ps1` shipped
   in v4.19.0.
3. **Server:** install **ARR** (the `setup-server.ps1` never mentions it, and it
   is what the reverse proxy needs), then the app's 9-section guide. Certificate
   **before** the HTTP→HTTPS redirect — the rule catches
   `/.well-known/acme-challenge/` and blocks the first issuance.
4. **Then publish the site.** At that moment the live dot, the CTAs and
   `LAUNCH.md` all become true at once. Flip the FAQ and add `/license` in the
   same deploy.
5. **After:** Stripe, and the payment → `repository_dispatch` step that mints a
   key and writes it to the Convex `licenses` table for the portal.

---

## 6. One thing worth building on the platform side

Every one of these contradictions lives in the gap between two repos that are
each rigorous inside their own boundary. The app's `pricing-feature-parity`
test cannot see the site; the site's `doctor` cannot see `feature-flags.js`.

A tenth `doctor` check would close it: fetch `server/lib/feature-flags.js` from
the app repo, parse the tier ceilings, and compare them with the plan strings in
`LanguageContext.tsx`. Same shape as `checkReadmeTwins`, one repo further out.
That is the only new machinery any of this needs.

---

## 7. What the shared Resend account touches

One account, three consumers, none of them documenting the sharing:

- **Convex (platform)** — `npx convex env set RESEND_API_KEY "re_..." --prod`
  opens client registration.
- **The app server** — refuses to boot in production without
  `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `EMAIL_FROM`. It says so
  explicitly: licence keys and retention warnings would never be delivered.
- **`mint-license.yml`** — already configured; the first real mint in April
  failed because the `bolalabs.pt` Resend domain verification was still
  pending, and the audit entry in `license-log` records exactly that.

Verify the domain once, then set it in all three.
