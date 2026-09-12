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
   GitHub migration. Open source. 81 seconds, sound on ↓ [video]
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

## Week 2 — Work Board and DORA

Film cut: scenes 5 and 6 (44.25 s to 63.75 s in the master), or the three
stills `docs/images/33_work_board_dark_hd.png`, the DORA tab and the Deep
Review capture as a LinkedIn carousel.

**LinkedIn (EN)**

> DORA is four numbers, and most teams buy a platform to see them.
>
> DevOps Research and Assessment — Google Cloud's research programme — found
> four measures that predict delivery performance: change lead time,
> deployment frequency, change fail rate, and how long it takes to recover
> from a failed deployment.
>
> GitHub already holds the data. Pull requests, Actions runs, the Deployments
> API. So the Work Board computes them from GitHub alone: lead time runs from
> the moment a pull request opens to the first successful production deploy
> after it merges.
>
> And when a repository has no deployment data, it says "PR cycle time"
> instead of quietly measuring something else and calling it DORA. That
> distinction is the whole reason to trust the number.
>
> Free, open source, self-hostable: [link]

**LinkedIn (PT)**

> DORA são quatro números, e a maioria das equipas compra uma plataforma para
> os ver.
>
> O DevOps Research and Assessment — o programa de investigação da Google
> Cloud — identificou quatro medidas que preveem o desempenho de entrega:
> lead time da alteração, frequência de deploy, taxa de falha e tempo de
> recuperação de um deploy falhado.
>
> O GitHub já tem os dados: pull requests, execuções do Actions, a API de
> Deployments. O Work Board calcula-os só a partir daí: o lead time vai desde
> a abertura da pull request até ao primeiro deploy de produção com sucesso
> depois do merge.
>
> E quando um repositório não tem dados de deploy, mostra "tempo de ciclo de
> PR" em vez de medir outra coisa e chamar-lhe DORA. É essa distinção que
> torna o número confiável.
>
> Gratuito, open source, auto-hospedável: [link]

**r/devops** — no link in the title, the definition up front, and the honest
limit in the first paragraph:

> I computed the four DORA metrics from the GitHub API alone — here's where it
> breaks down
>
> Lead time needs a deployment signal. GitHub's Deployments API has one if you
> use it; Actions alone doesn't tell you what reached production. So the tool
> measures PR opened → first successful production deployment after merge when
> deployments exist, and says "PR cycle time" when they don't. Rework rate I
> don't compute at all — I couldn't find a signal in GitHub that isn't a guess.
> Curious how others draw that line. [repo link in a comment]

## Week 3 — AI review, and why BYOK is permanent

Film cut: scene 7 (50.25 s to 63.75 s), captioned.

**LinkedIn (EN)**

> I will never resell you AI inference.
>
> Repo Manager's Deep Review reads a pull request's diff, ranks risk per file,
> writes the walkthrough, draws the sequence diagram, and publishes one review
> to GitHub. It runs on your key — Gemini, Anthropic, OpenAI, OpenRouter, or a
> local model.
>
> That's a product decision, not a limitation. Paid plans sell headroom,
> support and migration help, never the model. You see the provider's own bill,
> every call is metered, and an optional monthly cap stops the spend where you
> say.
>
> It also never commits for you. Everything that touches your repository goes
> preview-first, through one code path, and opens a pull request.
>
> [link]

**LinkedIn (PT)**

> Nunca lhe vou revender inferência de IA.
>
> O Deep Review do Repo Manager lê o diff de uma pull request, classifica o
> risco por ficheiro, escreve o walkthrough, desenha o diagrama de sequência e
> publica uma só review no GitHub. Corre com a sua chave — Gemini, Anthropic,
> OpenAI, OpenRouter ou um modelo local.
>
> É uma decisão de produto, não uma limitação. Os planos pagos vendem
> capacidade, suporte e ajuda na migração, nunca o modelo. A fatura é a do
> fornecedor, cada chamada é medida, e um limite mensal opcional trava o gasto
> onde quiser.
>
> E nunca faz commit por si: tudo o que toca no repositório passa primeiro por
> pré-visualização, num só caminho de código, e abre uma pull request.
>
> [link]

**Dev.to article** — "Shipping an AI code reviewer that never auto-commits":
the preview-first write primitive, the spend cap, and what the review looks
like on GitHub. One still, one code block, the repo link at the end.

## Week 4 — Migration

Film cut: scene 8 plus the close (63.75 s to the end).

**LinkedIn (EN)**

> Leaving Azure DevOps is a project. It shouldn't also be a mystery.
>
> The migration wizard takes Git repositories, TFVC history, work items and
> wikis from Azure DevOps — cloud or on-prem TFS from 2018 on — and moves them
> to GitHub. Every run starts as a dry run: it validates and shows you the plan
> before anything is created.
>
> [link]

**LinkedIn (PT)**

> Sair do Azure DevOps é um projeto. Não devia ser também um mistério.
>
> O assistente de migração leva repositórios Git, histórico TFVC, work items e
> wikis do Azure DevOps — cloud ou TFS on-prem de 2018 em diante — para o
> GitHub. Cada execução começa como ensaio: valida e mostra o plano antes de
> criar o que seja.
>
> [link]

**r/azuredevops** — ask, don't pitch: "What did your Azure DevOps → GitHub
migration miss?" Describe what the wizard moves and what it does not, and ask
what people hit. Link only in a comment.

Rules that hold across all four weeks: one framing per community, never the
same text on Reddit and HN; name the two honest limits (AI needs your own key;
the native installer is Windows-only); answer every comment on the first day.

## Measuring

Weekly, same day: site visits by `utm_source`, GitHub stars and unique
cloners (Insights → Traffic), sign-ups on the hosted app (admin panel),
Sentry issues opened. Retro at the end of week 4 before a second push.

## Wiring e-mail and browser errors (owner)

Resend, once for both products:

The `RESEND_API_KEY` secret already in the repository answers **401
Unauthorized** to `api.resend.com` — it exists but does not authenticate, so
treat it as absent.

1. resend.com → Domains → add `bolalabs.pt`; add the SPF, DKIM and MX
   records it shows at the DNS provider; wait for **Verified**.
2. API Keys → create one with *Sending access* for `bolalabs.pt`.
3. Repo Manager: GitHub → Settings → Secrets and variables → Actions →
   secret `RESEND_API_KEY`; variable `EMAIL_FROM` =
   `Repo Manager <no-reply@bolalabs.pt>`; optionally variable
   `TEST_EMAIL_TO` = the inbox you want the test in. Then Actions →
   *Ops — IIS proxy* → action `configure-integrations`. It refuses an
   unverified domain, restarts the service, and rolls back if health fails.
4. Prove it: run the `email-test` action. It sends one real message with the
   service's own key and prints the provider's message id. Until a message
   arrives, e-mail is not working — the console adapter answers ok for mail
   nobody receives, which is exactly how this stayed broken.
5. Site: `npx convex env set RESEND_API_KEY "re_..." --prod` in
   `bolalabs-platform`, then check `email:emailVerificationStatus`
   answers `{"enabled":true}`. Send yourself a message through the contact
   form and confirm it arrives.

Sentry in the browser:

1. In the Sentry project: Settings → Security & Privacy → *Data scrubber*
   on, *Prevent storing of IP addresses* on. Alerts → new issue alert.
2. Client Keys (DSN) → copy the DSN (the same one the server uses is
   fine) → GitHub variable `SENTRY_BROWSER_DSN`; optional variable
   `SENTRY_ENVIRONMENT` = `production`.
3. Run `configure-integrations` again (it writes whichever are set), then
   `env-check` to see both marked SET.

## Selling Pro (owner)

Do e-mail first: a completed checkout mints a signed licence key and e-mails
it, and the issuer now refuses to send through the console adapter rather than
marking a key as delivered that nobody received.

1. **Stripe → Product catalog**: create **Pro** with a $19/month price, and a
   yearly price if you want the pricing page's yearly toggle to appear (it
   stays hidden while `STRIPE_PRICE_PRO_YEARLY` is unset). Copy the **price**
   ids (`price_…`), not the product ids. Leave Enterprise without prices —
   every surface sends it to contact.
2. **Stripe → Developers → Webhooks → Add endpoint**:
   `https://repomanager.bolalabs.pt/api/v1/webhooks/stripe`, events
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`,
   `invoice.payment_failed`. Copy the signing secret (`whsec_…`).
3. **GitHub → Settings → Secrets and variables → Actions**: secrets
   `STRIPE_SECRET_KEY` (`sk_live_…`) and `STRIPE_WEBHOOK_SECRET`; variables
   `STRIPE_PRICE_PRO_MONTHLY` and, if created, `STRIPE_PRICE_PRO_YEARLY`.
4. Run **`configure-integrations`**. It writes all three or none, checks the
   prefixes, says so loudly if the key is a test key, restarts the service and
   rolls back on a failed health check. Then confirm
   `https://repomanager.bolalabs.pt/api/v1/billing/config` answers
   `"stripeEnabled": true`.
5. **Buy it yourself once.** Sign in on the hosted app, open Pricing, upgrade,
   pay with a real card (or a test key and `4242 4242 4242 4242` first), and
   check three things: Settings → Billing shows Pro, the licence e-mail
   arrives, and Stripe's webhook log shows the events delivered with 2xx.
6. Flip the site's `REPOMANAGER_SELF_SERVE_PRO` to `true` in
   `bolalabs-platform/src/site.ts` and cut a site release. That is what moves
   the Pro card from "Request a demo" to a checkout button; while Stripe is
   off it deliberately stays on the form, because a checkout page that says
   "not available here" is worse than a form.
7. Refund yourself in Stripe, and keep the invoice — it is the first
   end-to-end proof that the billing path works.

Full reference, including local testing with the Stripe CLI:
[`docs/guides/stripe-setup.md`](../guides/stripe-setup.md).
