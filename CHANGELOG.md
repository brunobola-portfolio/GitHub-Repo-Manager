# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **License Mint Automation**: GitHub Actions-based Ed25519 license minting pipeline
  - `scripts/lib/minter.js` primitives: `validateInput`, `mintLicense`, `deliverLicense`, `logMint`, `mint-license-action.js` CLI wrapper
  - `mint-license.yml` workflow with SHA-pinned actions and scoped `LICENSE_PRIVATE_PEM` secret
  - Resend-based text-only email delivery
  - Optimistic concurrency and audit trail (separate private audit repo pattern)
  - `::add-mask::` safety for sensitive values; `mint-failure-notify.js` standalone error handler
  - Dependabot-managed GitHub Actions and Docker bumps (Node 24 compat)
- **License Kid Header & Resolver API**: `server/lib/license.js`
  - JWT `kid` header and algorithms allowlist for key rotation
  - Unified resolver wrapping with async support
- **License Badge UI**: Header pill showing active tier from `/api/v1/license` endpoint
  - Reads tier from Stripe subscription or license key
  - Dark-mode friendly
- **Modal System Redesign**: Shared `Modal` primitive consolidation
  - `useBodyScrollLock` hook, safe for stacked modals and React Strict Mode
  - `InsightCard` shared component with tones and stagger animations
  - `StatBar` animated progress bar, hardened against NaN/undefined
  - `Modal` enhancements: subtitle, 2xl/3xl sizes, body scroll lock, `staggerChildren`, `iconGradient`, `tabs` prop (embeds `TabBar` in header), `mobileVariant` (sheet/centered) with safe-area
  - Migrations to shared primitive: `SettingsModal`, `TransferModal`, `OrgManagerModal`, `RepoInsightsModal`, `CreateRepoModal`, `CommitGeneratorModal`
  - a11y ids, tab-panel association, sheet size ordering fixes
- **Reusable TabBar**: Shared component with 3 variants and WAI-ARIA keyboard navigation
  - Migrations: `Teams`, `Migration`, `PRDetail`, `OrgManager`, `Insights`, `Settings`, `RepoDetail`, `Health`
  - Unit tests for variants, ARIA, keyboard nav
- **Community Health Tabs**: Tabbed reorganization of health dashboard with animated sliding indicator
  - Desktop-only integration (mobile preserved as stacked)
  - Tab switching tests and mobile exclusion tests
  - `aria-labelledby` for tab panels
- **Health Dashboard Premium**: Visual overhaul of community health dashboard
- **PR Review Experience (in progress)**: Spec + plan for premium PR review UI with file tree, diff viewer, AI insights, conversation threads
- **Context Menu + Pricing Polish**: Scroll-free native context menu and dazzle-hover pricing cards
- **Rate Limit UX + Dev Fix**: User-friendly banners + dev-mode rate limit exemption
- **AI Submenu Redesign**: Per-item tab routing for AI Assistant submenu

### Changed

- `WizardPanel` now uses shared `useBodyScrollLock`; icon tile gained hover-glow for consistency

### Fixed

- Teams fetch gracefully handles `MOCK_MODE` and free-tier 403
- Tailwind JIT safelist for landscape fallback classes
- Minter CRLF→LF normalization before fingerprinting public key
- SESSION_SECRET test env var for vitest CI runs
- Mint-license workflow: private PEM scoped only to needed steps, surfaces audit commitSha
- Minter shebang removal + `.gitattributes` for cross-platform line endings

### Docs

- Specs and plans for all April 2026 work indexed in [docs/index.md](docs/index.md)
- Validation screenshots reorganized into `docs/images/` with sequential numbering
- Setup checklist months cap and Secrets vs Variables split corrected

## [3.0.0] - 2026-04-05

### Added

- **AGPL Open-Core Licensing**: Transitioned from MIT to AGPL v3 with commercial dual-license
  - Ed25519 JWT license key generation and validation
  - License info and validation API endpoints
  - License keys table and `LICENSE_KEY` config
  - Tier middleware resolves from Stripe subscription or license key
  - License info display in billing section for self-hosted instances
  - CLA bot workflow and updated contributing guide
- **SaaS Architecture Foundation**: Multi-phase platform transformation
  - Phase 1: SaaS architecture foundation (multi-tenancy, user_id scoping)
  - Phase 2: Cloud deployment and infrastructure (Vercel, Railway, Docker, Redis)
  - Phase 3: Auth, security, and enterprise features (API keys, SSO prep, audit logs)
  - Phase 4: Monetization and billing (Stripe checkout, portal, webhooks, usage metering)
  - Phase 5: Marketing and GTM (landing page, pricing page)
- **Pricing Page**: Redesigned layout with tier alignment and monetization strategy
  - Pro checkout wired to Stripe billing API
  - Stripe setup guide documentation

### Changed

- **License**: MIT → AGPL v3 with commercial license option (CLA required for contributions)
- **Landing Page**: Updated URLs and branding

### Fixed

- Sign-in unblocked by scoping migration tier gate
- IPv6 rate-limit validation and wrong landing page URLs
- Critical security review findings resolved
- All lint errors and test failures resolved
- Pricing badge alignment and overflow clipping
- Broken license link in plan documentation

### Security

- Security review: critical findings resolved (credential handling, input validation)
- Dangerous auto-allow del permission removed from Claude settings

## [2.5.0] - 2026-03-31

### Added

- **Azure DevOps Migration Suite**: Guided multi-step wizard (8 steps) for comprehensive Azure DevOps-to-GitHub migration
- **TFVC-to-Git Conversion**: Automatic conversion via Azure DevOps Import API
- **Work Items Migration**: Azure Boards to GitHub Issues with field mapping
- **Wiki Migration**: Azure DevOps to GitHub wiki with content conversion
- **AI-Assisted Migration Planning**: Gemini-powered risk analysis and migration recommendations
- **Migration Scheduling**: Encrypted credential storage (AES-256-GCM) for deferred migrations
- **Pause/Resume**: Capability for long-running migrations
- **Task Retry**: Individual failed migration tasks can be retried independently
- **Migration History**: Full audit trail for all migration operations
- **Smart Azure DevOps URL Parser**: Supports 6+ URL format variations with auto-fill
- **Dry-Run Mode**: Test migrations without making changes
- **Conflict Detection**: Pre-migration check for existing repositories in target organization

### Changed

- **Migration Wizard Redesign**: Fullscreen panel layout replacing modal-based wizard
- **Summary Step**: Redesigned with detailed migration plan review
- **Organization Field**: Smart auto-detection based on authentication method
- **Configure Step**: Improved UX with dashboard header and compact card-row layout

### Fixed

- TFVC credential embedding double-`@` and URL encoding for PAT-based authentication
- TFVC URL encoding for projects with spaces in their names
- TFVC repositories now shown in mixed Git+TFVC Azure DevOps projects
- TFVC folder size calculation and branch 404 errors
- Wizard navigation state management fixes

### Security

- Structured logging with Pino (automatic credential redaction)
- SSRF protection for work item attachment downloads
- Encrypted credential storage (AES-256-GCM) for scheduled migrations

## [2.4.0] - 2026-02-07

### Added

- **Security Hardening** (Critical):
  - Helmet.js middleware for HTTP security headers (CSP, X-Frame-Options, HSTS, etc.)
  - express-rate-limit: 200 req/15min for API, 20 req/15min for auth endpoints
  - `SESSION_SECRET` enforcement in production (server refuses to start with default secret)
  - GitHub username input validation on activity, team members, and collaborators endpoints
  - `safeError()` utility to sanitize error messages and prevent internal detail leakage
- **GitHub API Optimization**:
  - ETag conditional requests — 304 responses don't count against rate limit
  - Rate limit header tracking with auto-wait before exceeding limits
  - Batched team activity fetching (3 concurrent + 100ms delay) instead of unlimited parallel
- **Accessibility**:
  - Focus trap in Modal component (Tab cycling, Shift+Tab, Escape to close, focus restore)
  - ARIA roles on Modal (`role="dialog"`, `aria-modal="true"`, `aria-label`)
  - Keyboard navigation for RepoCards (`tabIndex`, `role="button"`, `onKeyDown` with Enter/Space)
  - ARIA attributes on selection checkboxes (`role="checkbox"`, `aria-checked`, `aria-label`)
- **Language Chart Colors**: GitHub-style color map for 38 languages with 20-color vibrant fallback palette
- **CSS Utilities**: Added missing `.no-scrollbar` and `.animate-spin-slow` classes
- **Premium Dashboard**: Category-based organization with collapsible sections
  - Overview, Organizations, PR/Issues, Actions Stats, Community Health sections
  - Smart sticky organization selector
  - Rich organization cards with star/fork/issue metrics

### Changed

- **Mobile Responsiveness**:
  - AI Assistant: responsive sizing (`w-[calc(100vw-2rem)] sm:w-80 md:w-96`, `h-[70vh] sm:h-[500px]`)
  - Repo card actions: visible on touch devices (`sm:opacity-0 sm:group-hover:opacity-100`)
  - CategorySection: responsive padding (`p-4 sm:p-6 lg:p-8`)
  - LanguageChart: fluid width (`maxWidth: 280px, width: 100%`)
  - Touch targets: minimum 44px on header buttons and nav buttons
- **Dark Mode**: Fixed background mismatch (`dark:bg-slate-900` → `dark:bg-slate-950` across App.jsx)
- **Performance**: Moved render-blocking Google Fonts `@import` to HTML `<link>` tags in `index.html`
- **StatCard**: Removed duplicate hover animation (`ds-hover-lift` CSS + Framer Motion `whileHover`)
- **README**: Updated Vite 6→7, added security stack to tech table, documented v2.0 completed milestones, expanded architecture diagram with security middleware layer
- **Screenshots**: Fresh 1920x1080 HD screenshots captured with Playwright MCP

### Fixed

- **SQL Injection** (Critical): Parameterized `repoIds` in `repo_metadata` query (`server/index.js:1062`)
- **Session Security**: Added `sameSite: 'lax'` to session cookie to prevent CSRF
- **OAuth Error Leak**: Removed `error_description` from OAuth redirect URL to prevent info exposure
- **Color Contrast**: Improved trend text contrast (`text-slate-400` → `text-slate-500` in StatCard)

### Security

- SQL injection vulnerability patched with parameterized placeholders
- HTTP security headers via Helmet.js (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, etc.)
- API rate limiting prevents brute-force and abuse
- Input validation prevents injection via GitHub username parameters
- Session cookie hardened with `httpOnly`, `sameSite: 'lax'`, `secure` in production

## [2.3.1] - 2025-12-17

### Added
- **Backend Architecture Documentation**: Created [`docs/architecture/backend.md`](docs/architecture/backend.md) documenting monolithic design decision
- **Azure DevOps Limitations**: Added clear limitations section in README for import feature
- **UI Warning**: AzureImportModal now displays prominent warning about basic import capabilities

### Fixed
- **Version Synchronization**: Updated package.json version to match CHANGELOG (2.3.0 → 2.3.1)
- **Security Enhancement**: Removed hardcoded GitHub Client ID from [`App.jsx`](src/App.jsx:158), delegating OAuth to backend
- **Code Quality**: Fixed ESLint warnings for unused variables in [`App.jsx`](src/App.jsx:26)
- **Documentation**: Updated README.md placeholder links from 'yourusername' to 'YOUR_USERNAME'
- **Repository URLs**: Standardized all GitHub repository references in documentation

### Changed
- **Azure DevOps Import Section**: Clarified in README that current implementation supports Git repository import only
- **Transparency**: Set clear expectations for users about Azure DevOps migration capabilities (v3.0+ roadmap)

## [2.3.0] - 2025-12-15

### Added
- **HD Screenshots**: Professional 1920x1080 screenshots captured using Playwright
  - Dashboard view with statistics and charts (`01_dashboard_hd.png`)
  - Repository list with filters and organization panel (`02_repositories_hd.png`)
  - Create repository modal interface (`03_create_repo_modal_hd.png`)
  - AI assistant chat interface (`04_ai_assistant_hd.png`)
  - Team hub management view (`05_teams_hub_hd.png`)
- **Comprehensive Documentation**: Complete README.md rewrite with:
  - Detailed feature documentation with visual examples
  - Step-by-step installation and configuration guides
  - Architecture overview with system diagram
  - Troubleshooting section with common issues and solutions
  - FAQ section covering general usage, AI features, and development
  - Roadmap for v2.0, v2.5, and v3.0
  - Contributing guidelines and support information
- **GitHub Permissions Guide**: Detailed table explaining required OAuth scopes and their purposes

### Changed
- **Mock Data Engine**: Enhanced `useGitHub` hook to generate realistic, context-aware mock data
  - Project-specific repository names (e.g., "fintech-dashboard", "ai-analytics-platform")
  - Realistic descriptions matching repository types
  - Varied programming languages and star counts
- **AI Mock Responses**: Improved simulated AI responses with actionable, project-specific advice
- **Screenshot Organization**: Reorganized documentation images with clear, numbered naming convention

### Improved
- README structure and navigation with emoji icons and clear sections
- Code examples and configuration snippets throughout documentation
- Visual hierarchy with tables, badges, and formatted content

## [2.2.0] - 2025-12-03

### Added
- **Premium UI/UX**: Complete visual overhaul with Glassmorphism design system
  - Semi-transparent backgrounds with backdrop blur effects
  - Layered shadows for depth perception
  - Smooth gradient overlays and border accents
- **Interactive Dashboard**: Real-time statistics and visualizations
  - Activity trends chart with time range selector
  - Language distribution pie chart
  - Top organizations horizontal bar chart
  - Animated stat cards with trend indicators
- **Enhanced Organization Panel**: Redesigned sidebar with improved UX
  - Organization search functionality
  - Grid/List view toggle
  - User profile section with avatar and username
  - Repository count badges

### Changed
- Refactored `Dashboard` component with `framer-motion` animations
- Updated `OrgPanel` with search and view mode state management
- Improved `App.jsx` layout to support new sidebar-based navigation
- Enhanced organization selection and data refresh logic

### Fixed
- Skeleton loading states for better perceived performance
- Organization data fetching race conditions
- Dark mode color inconsistencies in charts

## [2.1.0] - 2025-12-02

### Added
- **AI Assistant Integration**: Google Gemini Flash-powered features
  - Conversational chat interface for repository management
  - Context-aware responses about your repositories
  - Natural language command processing
- **AI-Powered Features**:
  - Smart description generator for new repositories
  - Repository quality analysis and insights
  - README generation and enhancement
  - Semantic repository search (with embeddings)
- **Dashboard Filtering**: Filter statistics and charts by organization
- **Enhanced Animations**: Integrated `framer-motion` for smooth transitions
  - Modal entry/exit animations
  - List item stagger effects
  - Page transition effects

### Changed
- AI configuration with graceful fallback to mock responses
- Server-side error handling for missing API keys
- UI feedback for AI feature availability status

### Fixed
- Organization data fetching in Dashboard component
- Server-side error handling for unconfigured AI endpoints
- AI API key validation on startup

## [2.0.0] - 2025-11-26

### Added
- **Theme System**: Dark/Light mode support
  - Persistent user preference in localStorage
  - System theme detection and auto-switching
  - Smooth theme transitions with Tailwind `dark:` variants
- **Dashboard View**: Comprehensive statistics and overview
  - Total repositories, public/private distribution
  - Fork count and organization memberships
  - Organization selector for filtered views
- **Organization Management**:
  - Organization panel with repository listings
  - Modal for viewing and editing organization details
  - Organization sync functionality
- **Azure DevOps Migration**: Complete import workflow
  - Connection validation and authentication
  - Project selection and mapping
  - Progress tracking and status updates
- **Activity Tracking**: Sidebar for monitoring operations
  - Bulk action history
  - Real-time status updates
  - Operation result notifications

### Changed
- Centralized GitHub data fetching in `useGitHub` hook
- Improved table, sidebar, and modal styling for accessibility
- Enhanced dark mode contrast ratios
- Added robust API utilities with retry logic and exponential backoff
- Implemented rich error types for better error handling

### Fixed
- Reduced unauthenticated API noise by conditional repo loading
- ESLint issues aligned with React/Node best practices
- Session persistence across page refreshes

## [1.0.0] - 2025-10-01

### Added
- **Initial Release**: GitHub Repo Manager MVP
  - GitHub OAuth authentication flow
  - Session-based backend with Express
  - Repository listing with pagination
  - Bulk repository selection interface
- **Bulk Operations**:
  - Change repository visibility (public/private)
  - Transfer repositories to organizations
  - Mirror repositories (fork)
  - Archive repositories
  - Delete multiple repositories
- **Activity Log**: Basic feedback system for operations
- **Responsive UI**: TailwindCSS-based interface

### Security
- Encrypted session cookies for token storage
- CSRF protection for API endpoints
- Secure OAuth callback handling

---

[Unreleased]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v2.5.0...v3.0.0
[2.5.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v2.3.1...v2.4.0
[2.3.1]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v2.3.0...v2.3.1
[2.3.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/releases/tag/v1.0.0
