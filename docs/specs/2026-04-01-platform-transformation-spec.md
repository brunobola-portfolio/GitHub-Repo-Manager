# Platform Transformation: Open-Core + SaaS

> **Status:** Approved | **Date:** 2026-04-01 | **Author:** Bruno Marques

## Vision

Transform GitHub Repo Manager from a local development tool into an **open-core platform** with a hosted SaaS offering. The product becomes the industry reference for **AI-powered GitHub repository management**.

## Business Model: Open-Core + Hosted SaaS

```
┌─────────────────────────────────────────────────────────────┐
│                    COMMUNITY EDITION (MIT)                   │
│  ─────────────────────────────────────────────────────────  │
│  Full dashboard, repo management, dark mode, UI premium     │
│  AI features with own API key (Gemini)                      │
│  Self-hosted: Docker / docker-compose                       │
│  Database: SQLite (zero config)                             │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    CLOUD EDITION (SaaS)                      │
│  ─────────────────────────────────────────────────────────  │
│  Zero setup: Sign in with GitHub                            │
│  AI included (no own API key needed)                        │
│  Multi-org dashboard with team collaboration                │
│  Freemium: Free ≤20 repos, Pro $19/mo, Enterprise $99/seat │
│  Database: PostgreSQL + Redis (managed)                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    ENTERPRISE ADD-ONS                        │
│  ─────────────────────────────────────────────────────────  │
│  SAML/SSO, audit logs, advanced migration (Azure DevOps)    │
│  Custom AI models, API access, SLA, on-premise deployment   │
│  Priority support, custom integrations                      │
└─────────────────────────────────────────────────────────────┘
```

## Market Context (April 2026)

| Metric | Value |
|--------|-------|
| DevOps market global | $16B → $51B by 2031 (21% CAGR) |
| AI DevOps segment | $12.6B in 2026 |
| Open-source services | $13B projected 2026 |
| VC in AI startups (2025) | $89.4B (34% of all VC) |
| Direct competitors in niche | **None funded** |

## Competitive Advantage

1. **AI-native from day 1** — 10+ AI features, not an afterthought
2. **Migration wizard** — Azure DevOps → GitHub with AI risk analysis (rare feature)
3. **Premium UX** — Developer tools are usually ugly; this isn't
4. **Single pane of glass** — Dashboard + repos + teams + migrations + AI in one place
5. **Self-hosted option** — Critical for enterprise compliance

## Architecture Evolution

### Current (v2.5.0 — Local App)
```
Browser → Vite (5173) → Express (3001) → SQLite (file)
                                        → GitHub API
                                        → Gemini AI API
                                        → Azure DevOps API
```

### Target (v3.0.0 — Platform)
```
                    ┌─── Vercel (Frontend CDN) ───┐
                    │                              │
Browser ──────────► │   React 19 SPA              │
                    │   (same codebase)            │
                    └──────────┬───────────────────┘
                               │ /api/*
                    ┌──────────▼───────────────────┐
                    │   API Gateway / Load Balancer │
                    └──────────┬───────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────▼──────┐ ┌──────▼──────┐ ┌───────▼──────┐
    │  API Server    │ │  AI Worker  │ │  Migration   │
    │  (Express)     │ │  (Express)  │ │  Worker      │
    │  Stateless     │ │  Queue-based│ │  Queue-based │
    └───────┬────────┘ └──────┬──────┘ └───────┬──────┘
            │                 │                 │
    ┌───────▼─────────────────▼─────────────────▼──────┐
    │              PostgreSQL (primary)                  │
    │              Redis (sessions + cache + queues)     │
    └──────────────────────────────────────────────────┘
```

### Self-Hosted (Community Edition)
```
docker-compose up → Express (3001) → SQLite (volume)
                    React built static files served by Express
                    Same codebase, DATABASE_URL=sqlite
```

## Convex Evaluation

Bruno has a Convex account. After analysis:

| Factor | Assessment |
|--------|-----------|
| Real-time subscriptions | Excellent for dashboard |
| TypeScript requirement | Conflicts with JSX-only rule |
| Git operations | Cannot run git CLI in Convex functions |
| Migration engine | Too complex for Convex functions |
| Rewrite cost | ~10,000 lines of backend to rewrite |
| **Verdict** | **Not for initial launch. Re-evaluate for real-time features in v3.1+** |

**Recommendation:** Keep Express backend. Use PostgreSQL for SaaS, SQLite for self-hosted. Database abstraction layer makes this transparent. Convex can be explored later for specific real-time dashboard features or as an alternative self-hosted database option.

## Implementation Phases

| Phase | Name | Duration | Key Deliverables |
|-------|------|----------|------------------|
| **0** | Open-Source Launch Prep | 1-2 weeks | Docker, community files, repo cleanup |
| **1** | SaaS Architecture | 2-3 weeks | DB abstraction, multi-tenancy, API versioning |
| **2** | Cloud Deployment | 1-2 weeks | CI/CD, Vercel + Railway, monitoring |
| **3** | Auth & Enterprise | 2-3 weeks | Multi-tenant OAuth, SSO, audit logs, API keys |
| **4** | Monetization | 2-3 weeks | Stripe, metering, pricing tiers, feature gates |
| **5** | Marketing & GTM | Ongoing | Landing page, Product Hunt, content, community |

## Pricing Model

| Tier | Price | Repos | AI Queries | Migration | Teams |
|------|-------|-------|------------|-----------|-------|
| **Free** | $0 | ≤20 | 50/month | No | No |
| **Pro** | $19/mo | Unlimited | 500/month | Basic (GitHub) | 3 members |
| **Enterprise** | $99/seat/mo | Unlimited | Unlimited | Full (Azure+GitHub+GitLab) | Unlimited |

## Multi-Computer Development Strategy

All plans committed to `docs/plans/` and synced via git:

1. **Start work on Computer A:** Pull latest, tell Claude Code to execute Phase N plan
2. **Switch to Computer B:** Pull latest, tell Claude Code to continue Phase N plan
3. **Progress tracking:** Checkbox syntax `- [x]` in plan files marks completed tasks
4. **Context:** Claude Code reads CLAUDE.md + MEMORY.md + the specific plan file
5. **Commits:** Each task has its own commit message — atomic, resumable

## Success Metrics

| Milestone | Target | Timeframe |
|-----------|--------|-----------|
| GitHub stars | 500 | Month 3 |
| Cloud signups | 200 | Month 4 |
| Paying customers | 20 | Month 6 |
| MRR | $1,000 | Month 8 |
| GitHub stars | 2,000 | Month 12 |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Low adoption | High | Open-source + Product Hunt + HN launch |
| Scaling costs | Medium | Freemium limits, usage-based billing |
| GitHub API changes | Medium | Abstract GitHub client, version pin |
| AI cost at scale | Medium | Per-tenant quotas, caching, model optimization |
| Solo developer burnout | High | Phased delivery, community contributions |

## Plans Index

Each phase has its own detailed implementation plan in `docs/plans/`:

1. [Phase 0: Open-Source Launch Prep](../plans/2026-04-01-phase0-opensource-launch-prep.md)
2. [Phase 1: SaaS Architecture](../plans/2026-04-01-phase1-saas-architecture.md)
3. [Phase 2: Cloud Deployment](../plans/2026-04-01-phase2-cloud-deployment.md)
4. [Phase 3: Auth & Enterprise](../plans/2026-04-01-phase3-auth-security-enterprise.md)
5. [Phase 4: Monetization](../plans/2026-04-01-phase4-monetization.md)
6. [Phase 5: Marketing & GTM](../plans/2026-04-01-phase5-marketing-gtm.md)
