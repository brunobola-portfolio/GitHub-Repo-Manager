# Launch kit — week 1, ready to post

Written against 4.25.0 (product) and 1.5.2 (site), both in production on
2026-09-11. Everything here is copy and a checklist; nothing has been
posted. The four-week plan it executes is §4 of
[the launch guide](2026-09-06-brand-docs-launch-guide-v2.md).

## Before the first post (owner, ~1 hour)

1. **Resend wired** — licence, notice and digest e-mails must arrive
   the day strangers try the hosted app, and the site's client-portal
   login link depends on the same key. Steps in
   [the review](2026-09-11-dora-sentry-site-vps-review.md) and in the
   final section of this kit.
2. **Sentry alert rule** on project 4512036544380928 ("a new issue" →
   e-mail), so a launch-day 500 reaches you before a comment does.
3. **Open `https://repomanager.bolalabs.pt` in a private window**, sign in
   with GitHub, open the Work Board and the DORA tab. That exact path is
   what the posts promise.
4. **Pin the repository** on the GitHub profile, and put the film poster
   as the social preview (Settings → Social preview →
   `.dev/promo/out/cards/lockup-1280x640.jpg`).

## Assets

| Use | File (in `.dev/promo/out/`) |
| --- | --- |
| LinkedIn, X, YouTube (16:9, EN) | `repomanager-promo-wide-en.mp4` + `repomanager-promo-en.srt` |
| LinkedIn PT | `repomanager-promo-wide-pt.mp4` + `repomanager-promo-pt.srt` |
| Feeds that autoplay square (LinkedIn mobile, Bluesky) | `repomanager-promo-square-en.mp4` |
| Shorts, Reels, TikTok | `repomanager-promo-tall-en.mp4` |
| Link cards / Open Graph | `cards/lockup-1200x630.jpg` |
| GitHub social preview | `cards/lockup-1280x640.jpg` |
| Product Hunt gallery | `cards/lockup-1920x1080.jpg`, `cards/question-1920x1080.jpg`, then `docs/images/*_dark_hd.png` |

Upload the video natively on every network — a YouTube link in a post
reaches a fraction of the people a native upload does. Most feeds play
muted: attach the subtitle file wherever the network accepts one.

## Links (UTM)

One convention so the site's cookieless analytics can tell the channels
apart: `?utm_source=<network>&utm_medium=social&utm_campaign=launch-w1`.

- Site: `https://bolalabs.pt/en/repomanager/?utm_source=linkedin&utm_medium=social&utm_campaign=launch-w1`
- App: `https://repomanager.bolalabs.pt/?utm_source=linkedin&utm_medium=social&utm_campaign=launch-w1`
- Code: `https://github.com/brunobola-portfolio/GitHub-Repo-Manager` (no UTM —
  GitHub Traffic counts referrers on its own)

Hacker News and Product Hunt strip or frown on tracking parameters: post
the plain GitHub URL there.

## Day 1 — LinkedIn (EN)

> I built the GitHub dashboard I wanted at work.
>
> Across twenty repositories, the questions are always the same: which
> reviews are waiting on me, which PRs have gone stale, and are we
> actually shipping faster? GitHub answers them one repository at a time.
>
> GitHub Repo Manager answers them for all of them at once:
>
> → a cross-repo Work Board — reviews, stale PRs, tech debt
> → DORA metrics from GitHub alone: change lead time to production,
> deployment frequency, change fail rate, recovery time
> → right-click quick actions and bulk operations on many repos at once
> → AI Deep Review of pull requests, with your own key (BYOK) — every
> call metered, nothing claimed that the code doesn't show
> → a wizard that migrates Azure DevOps and TFS/TFVC to GitHub
>
> Open source (Apache-2.0). Hosted at repomanager.bolalabs.pt, self-host
> with Docker or IIS, or install natively on Windows.
>
> One minute, with sound ↓
> [native video] · link in the first comment

First comment: the site link with UTM, then the GitHub link.

## Day 1 — LinkedIn (PT)

> Construí o painel de GitHub que queria ter no trabalho.
>
> Com vinte repositórios, as perguntas são sempre as mesmas: que reviews
> estão à minha espera, que PRs pararam, e estamos mesmo a entregar mais
> depressa? O GitHub responde um repositório de cada vez.
>
> O GitHub Repo Manager responde para todos ao mesmo tempo:
>
> → um Work Board entre repositórios — reviews, PRs paradas, dívida técnica
> → métricas DORA só a partir do GitHub: lead time até produção,
> frequência de deploy, taxa de falha e tempo de recuperação
> → ações rápidas no clique direito e operações em lote
> → AI Deep Review de pull requests com a sua própria chave (BYOK)
> → um assistente que migra Azure DevOps e TFS/TFVC para GitHub
>
> Open source (Apache-2.0). Alojado em repomanager.bolalabs.pt, ou em
> Docker, IIS ou instalação nativa no Windows.
>
> Um minuto, com som ↓

Post it a day after the English one, with the Portuguese cut.

## Day 1 — X / Bluesky (EN, thread)

1. One dashboard for every GitHub repository you own: cross-repo Work
   Board, DORA metrics, AI PR review with your own key, and Azure DevOps →
   GitHub migration. Open source. 1 min, sound on ↓ [video]
2. DORA without a separate tool: lead time runs from PR opened to the
   first successful production deploy after merge — from the GitHub
   Deployments API, nothing to install. [still: DORA tab]
3. AI review is BYOK and metered: bring a Gemini, Anthropic, OpenAI or
   OpenRouter key, or point it at a local model; every call has a spend
   cap and an audit line. [still: Deep Review]
4. Apache-2.0. Hosted, Docker, IIS, or a native Windows installer.
   github.com/brunobola-portfolio/GitHub-Repo-Manager

## Day 2 — Show HN

Title (80 chars max, no superlatives):

> Show HN: GitHub Repo Manager – cross-repo work board and DORA metrics for GitHub

Text:

> I manage a few dozen repositories and kept answering the same questions
> by clicking through them one at a time: what's waiting on my review,
> what's gone stale, how long does a change take to reach production.
> This is the dashboard I built for that.
>
> What it does: a Work Board across every repository (reviews waiting on
> you, stale PRs, tech debt), DORA metrics computed from GitHub alone
> (lead time is PR opened → first successful deployment after the merge,
> from the Deployments API; without deployments it says "PR cycle time"
> rather than pretending), bulk operations, AI pull-request review with
> your own key, and a migration wizard for Azure DevOps and on-prem
> TFS/TFVC.
>
> Stack: React 19 + Vite, Express 5 + SQLite. Runs hosted, in Docker,
> behind IIS, or as a native Windows install. Apache-2.0.
>
> Honest limits: the AI features need your own key (I don't resell
> inference); the native installer is Windows-only; deployment-rework rate
> isn't computed because GitHub has no reliable signal for it.
>
> Hosted: `https://repomanager.bolalabs.pt` — code:
> `https://github.com/brunobola-portfolio/GitHub-Repo-Manager`

Post between 14:00 and 16:00 Lisbon time on a Tuesday–Thursday, and stay
on the thread for the first three hours.

## Day 3 — Product Hunt

- **Name:** GitHub Repo Manager
- **Tagline (60):** Cross-repo work board and DORA metrics for GitHub
- **Topics:** Developer Tools, GitHub, Open Source, Productivity
- **Gallery:** the film first, then the two cards, then four dark
  screenshots (dashboard, Work Board, DORA, Deep Review).
- **Maker comment:** the Show HN text, first person, shortened to three
  paragraphs; end with the one question you want answered ("which
  metric would you want next?").

Launch at 00:01 Pacific (08:01 Lisbon) so the whole day counts.

## Weeks 2–4

Unchanged from the launch guide §4: Work Board and DORA (r/devops, with
the DORA definition up front), AI review and BYOK (Dev.to article), then
migration (r/azuredevops). One framing per community; never the same text
on Reddit and HN.

## Measuring

Weekly, same day: site visits by `utm_source`, GitHub stars and unique
cloners (Insights → Traffic), sign-ups on the hosted app (admin panel),
Sentry issues opened. Retro at the end of week 4 before a second push.

## Wiring e-mail and browser errors (owner)

Resend, once for both products:

1. resend.com → Domains → add `bolalabs.pt`; add the SPF, DKIM and MX
   records it shows at the DNS provider; wait for **Verified**.
2. API Keys → create one with *Sending access* for `bolalabs.pt`.
3. Repo Manager: GitHub → Settings → Secrets and variables → Actions →
   secret `RESEND_API_KEY`; variable `EMAIL_FROM` =
   `Repo Manager <no-reply@bolalabs.pt>`. Then Actions → *Ops — IIS
   proxy* → action `configure-integrations`. It refuses an unverified
   domain, restarts the service, and rolls back if health fails.
4. Site: `npx convex env set RESEND_API_KEY "re_..." --prod` in
   `bolalabs-platform`, then check `email:emailVerificationStatus`
   answers `{"enabled":true}`.

Sentry in the browser:

1. In the Sentry project: Settings → Security & Privacy → *Data scrubber*
   on, *Prevent storing of IP addresses* on. Alerts → new issue alert.
2. Client Keys (DSN) → copy the DSN (the same one the server uses is
   fine) → GitHub variable `SENTRY_BROWSER_DSN`; optional variable
   `SENTRY_ENVIRONMENT` = `production`.
3. Run `configure-integrations` again (it writes whichever are set), then
   `env-check` to see both marked SET.
