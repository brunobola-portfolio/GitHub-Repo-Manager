# First five minutes

From sign-in to a migration dry run, on the public instance or your own
install. Nothing here is new; every step links to the page that owns it.

## 1. Sign in with GitHub (30 s)

Open [repomanager.bolalabs.pt](https://repomanager.bolalabs.pt) (or your own
origin) and choose **Continue with GitHub**. The OAuth scopes requested are
listed under [GitHub permissions](../../README.md#github-permissions); the
session is a rolling httpOnly cookie, no token is stored in the browser.

Want to look around without an account? The demo runs the whole UI on
recorded data: [Quick Start (Demo Mode)](../../README.md#quick-start-demo-mode).

## 2. Add an AI key, or skip it (1 min)

**Settings → AI Configuration**. Pick a provider (Anthropic, OpenAI, Google
Gemini, OpenRouter or a local model), paste your key, save. It is encrypted
at rest with AES-256-GCM and only your calls use it. Without a key the AI
surfaces answer with mock responses so the UI still works.

Details, per provider: [AI providers (BYOK)](../ai-providers.md). Spend cap
and per-call token caps are on by default.

## 3. Track the repositories that matter (1 min)

The Work Board seeds itself from five signals (review-requested, authored,
assigned, owned, recently committed). Open **Work Board**, and pin, mute or
untrack from any row; **Settings → Work Board** adds the discovery panel and
bulk actions. The DORA tab computes from the tracked set.

Keyboard: `?` shows the shortcuts; `Ctrl+K` opens the command palette.

Reference: [Cross-Repo Work Board](../../README.md#cross-repo-work-board).

## 4. Run a migration dry run (2 min)

**Migration Wizard** → choose Azure DevOps (cloud or on-prem) or TFVC, paste
an organisation or project URL, authenticate with a PAT created on that
server, select repositories. The **Plan review** step validates names,
targets and permissions before anything is created; nothing is written until
you confirm on the next step.

Reference: [What you can migrate](../../README.md#what-you-can-migrate) ·
[Migration features](../../README.md#migration-features).

## What to read next

- [Tour](../tour.md) — the 38-second film and its storyboard.
- [Screenshot gallery](../screenshots.md) — every view, both themes.
- [Operations runbook](../operations.md) — when you run it for others.
