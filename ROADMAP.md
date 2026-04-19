# Roadmap

A thin mirror of the in-app Roadmap page (`/roadmap`). Everything here is honestly either in progress or on the wishlist — nothing on the Pricing Page is vaporware.

## Shipping Now (Q2 2026)

- **Azure DevOps Server (on-premise)** — Enterprise. PAT + URL adaptation for self-hosted Azure DevOps.
- **GitLab Migration Importer** — Pro + Enterprise. Clone GitLab repos with history.
- **Advanced Analytics Dashboard** — Enterprise. Commit heatmaps, contributor insights, dependency graph.
- **Dependency Graph Visualizer** — Pro. Interactive graph of repo dependencies.
- **CODEOWNERS Generator** — Free. Auto-generate and validate CODEOWNERS files.
- **Compare with Existing** — Pro. Semantic similarity search (Wave 2).
- **Security & Secrets Scan** — Pro. Aggregates GitHub's native security alerts (Wave 2).
- **README Enhance** — Pro. AI-generated diff of improved README (Wave 2).
- **Batch Indexing** — Pro. Bulk AI indexing of selected repositories (Wave 2).

## Next (Q3 2026)

- **Bitbucket Migration Importer** — Pro + Enterprise.
- **SSO / SAML** — Enterprise. Okta, Azure AD, SAML 2.0.
- **Backup & Restore System** — Enterprise.
- **Security Alerts Dashboard** — Pro. Cross-repo CVE aggregation.
- **SBOM Export** — Enterprise. CycloneDX + SPDX.
- **Release Notes Generator** — Pro. AI from commits + PRs.

## Later (Q4 2026+)

- **GitHub Enterprise Server** — Enterprise.
- **Plugin / Extension System** — Free + Pro.
- **Mobile App (React Native)** — all tiers.
- **Org Permissions Sync** — Enterprise.
- **Dependabot Aggregation** — Pro.
- **Custom Workflow Templates** — Pro.

## Recently Shipped (March–April 2026)

- **BYOK multi-provider AI** (April 2026) — Gemini, Anthropic, OpenAI, OpenRouter, LMStudio; per-user key config; AES-256-GCM encryption at rest
- **Custom AI Model Selection** (April 2026) — covered by BYOK; users choose provider + model in Settings → AI Configuration
- **GitHub event ingestion pipeline** (April 2026) — real-time PR, issue, and deployment webhook ingestion
- **Cross-Repo Work Board** (April 2026) — my reviews, stale PRs, my issues, review load, DORA metrics (deploy freq + lead time)
- **SOC 2 code hardening** (April 2026) — append-only audit log with SHA-256 hash chain, self-service data erasure (GDPR Art. 17), startup secrets verification, data retention pass with warning emails
- **Stripe billing + license key delivery** (April 2026) — Ed25519-signed JWT license keys issued and emailed on checkout completion
- **Command Palette** — Ctrl+K keyboard-first navigation across the full app
- **Bulk operations safety** — confirmation dialogs, dry-run mode, tier-gated destructive actions
- Product Honesty Pass — Wave 1 (context menu completeness)
- Product Honesty Pass — Wave 3 (UI polish, pricing, roadmap)
- Toast Context Provider refactor
- PR Review Experience (file tree, diff viewer, AI insights, threads)
- License Badge + License Mint Automation (Ed25519 JWT)
- Context Menu (scroll-free, native performance)
- Modal System Redesign (shared primitive, body scroll lock)
- Health Dashboard Premium (tabbed organization, visual polish)
- Rate Limit UX (friendly notices + dev-mode exemption)
- Landing Page (hero, features, CTA)
- AGPL Open-Core License Key System (Ed25519 JWT)

See `docs/specs/` and `docs/plans/` for detailed design and implementation history.
