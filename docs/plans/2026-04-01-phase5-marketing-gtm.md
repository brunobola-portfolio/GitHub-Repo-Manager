# Phase 5: Marketing & Go-to-Market

> **For agentic workers:** This plan contains both CODE tasks (landing page, SEO) and NON-CODE tasks (marketing actions, content, community). Code tasks use checkbox syntax. Non-code tasks are action items for the developer/founder to execute manually.

**Goal:** Launch the platform publicly, build community, create awareness, and acquire the first 200 signups and 20 paying customers.

**Spec:** `docs/specs/2026-04-01-platform-transformation-spec.md`

**Prerequisites:** Phases 0-4 complete (platform deployed, billing active).

---

## Parallelism Map

Tasks 1, 2 can run in parallel (code tasks).
Tasks 3, 4, 5, 6 are action-oriented and timeline-based.
Task 7 is ongoing.

---

## Task 1: Landing Page

**Files:**
- Create: `src/components/Landing/LandingPage.jsx`
- Create: `src/components/Landing/HeroSection.jsx`
- Create: `src/components/Landing/FeaturesSection.jsx`
- Create: `src/components/Landing/TestimonialsSection.jsx`
- Create: `src/components/Landing/CTASection.jsx`
- Modify: `src/App.jsx` (render landing for unauthenticated users)

- [ ] **Step 1.1: Design landing page structure**

  The landing page replaces the login screen for unauthenticated users.

  Sections:
  1. **Hero** — Headline, subheadline, CTA button, hero screenshot/demo
  2. **Social Proof** — "Trusted by X developers" / GitHub stars badge
  3. **Features Grid** — 6 key features with icons and descriptions
  4. **AI Showcase** — Interactive demo or GIF showing AI features
  5. **Migration Section** — Azure DevOps migration highlight
  6. **Pricing Preview** — 3 tiers with "Start Free" CTA
  7. **Open Source** — "Self-host for free" + GitHub link
  8. **Footer** — Links, social, "Built by Bruno Marques"

- [ ] **Step 1.2: Create HeroSection**

  ```jsx
  // Full-width gradient hero
  // "Manage your GitHub repos with AI superpowers"
  // "The open-source platform for intelligent repository management"
  // [Sign in with GitHub] primary CTA
  // [View on GitHub] secondary CTA
  // Hero image: dashboard screenshot with glassmorphism frame
  ```

  Use existing design system: `ds-gradient-text`, `ds-glass`, Framer Motion entrance animations.

- [ ] **Step 1.3: Create FeaturesSection**

  6 feature cards in 3x2 grid:
  1. AI-Powered Insights — Quality reports, suggestions, analysis
  2. Semantic Search — Find repos by meaning, not keywords
  3. Smart Migration — Azure DevOps → GitHub with AI risk analysis
  4. Team Collaboration — Shared dashboards, activity feeds
  5. README Generation — AI-crafted documentation in seconds
  6. Premium Dashboard — Beautiful analytics, dark mode, responsive

  Each card: Lucide icon + title + description + subtle hover animation.

- [ ] **Step 1.4: Create CTASection**

  ```jsx
  // "Ready to level up your repo management?"
  // [Start Free — No credit card required]
  // "Or self-host with Docker: docker-compose up"
  // Terminal-style code block showing docker command
  ```

- [ ] **Step 1.5: Create LandingPage (compose sections)**

  Assemble all sections with Framer Motion scroll animations (fade-in-up on viewport enter).

- [ ] **Step 1.6: Route unauthenticated users to landing**

  Read `src/App.jsx`. When user is not authenticated:
  - Show LandingPage instead of the current login screen
  - Keep "Sign in with GitHub" as the primary action
  - Pricing page accessible from landing

- [ ] **Step 1.7: Add meta tags for SEO**

  Read `index.html`. Add:
  ```html
  <title>GitHub Repo Manager — AI-Powered Repository Management</title>
  <meta name="description" content="The open-source platform for intelligent GitHub repository management. AI insights, semantic search, migration tools, and team collaboration.">
  <meta property="og:title" content="GitHub Repo Manager">
  <meta property="og:description" content="Manage your GitHub repos with AI superpowers">
  <meta property="og:image" content="/og-image.png">
  <meta name="twitter:card" content="summary_large_image">
  ```

- [ ] **Step 1.8: Commit**

  ```
  feat(landing): add public landing page with features, pricing preview, and SEO
  ```

---

## Task 2: GitHub Marketplace Preparation

**Files:**
- Create: `.github/app-manifest.yml` (or configure via GitHub UI)

- [ ] **Step 2.1: Research GitHub Marketplace listing requirements**

  GitHub Marketplace for OAuth apps requires:
  - Published listing with description, screenshots, pricing
  - Terms of service and privacy policy URLs
  - Support URL
  - Webhook endpoint for marketplace events

- [ ] **Step 2.2: Create Terms of Service and Privacy Policy pages**

  Create simple pages (can be markdown rendered in the app or separate URLs):
  - Terms of Service — Standard SaaS terms
  - Privacy Policy — What data is collected, how it's used, GDPR compliance

  These can be static pages served by the frontend or hosted externally.

- [ ] **Step 2.3: Prepare marketplace listing content**

  Draft:
  - One-line description (under 100 chars)
  - Detailed description (features, benefits, use cases)
  - 3-5 screenshots (dashboard, AI assistant, migration wizard)
  - Categories: "Repository management", "Code quality", "Project management"
  - Pricing plans (mirror Stripe tiers)

- [ ] **Step 2.4: Commit any code changes**

  ```
  chore(marketplace): prepare GitHub Marketplace listing assets
  ```

---

## Task 3: Launch Sequence (Week 1-2 after deploy)

> **Non-code tasks.** These are manual actions for the founder to execute.

### Pre-Launch Checklist

- [ ] **3.1: Final QA pass** — Test complete user journey: signup → explore → AI query → upgrade → checkout
- [ ] **3.2: Record demo video** — 3-5 minute walkthrough showing key features (Loom or OBS)
- [ ] **3.3: Prepare launch assets**:
  - Product Hunt thumbnail (240x240)
  - Product Hunt gallery (1270x760, 3-5 images)
  - Social media preview image (1200x630 for OG)
  - GIF showing the dashboard in action (for README and socials)
- [ ] **3.4: Set up analytics** — Plausible or PostHog (privacy-friendly, open-source)

### Launch Day Actions

- [ ] **3.5: Product Hunt launch**
  - Title: "GitHub Repo Manager — AI-powered repository management, open source"
  - Tagline: "Manage your GitHub repos with AI superpowers"
  - First comment: Personal story of why you built it
  - Schedule for Tuesday or Wednesday at 00:01 PT (best launch days)
  - Ask 5-10 people to upvote and leave genuine comments

- [ ] **3.6: Hacker News "Show HN" post**
  - Title: "Show HN: I built an open-source AI-powered GitHub repo manager"
  - Include: What it does, tech stack, link to GitHub + live demo
  - Post in the morning (US time) on a weekday
  - Be ready to answer questions in comments for 2-3 hours

- [ ] **3.7: Reddit posts** (spread over 2-3 days, not spam)
  - r/selfhosted — "I made an open-source GitHub repo manager with Docker support"
  - r/webdev — "Built this with React 19 + Tailwind v4 — AI-powered GitHub dashboard"
  - r/devops — "Open-source tool for managing GitHub repos across organizations"
  - r/reactjs — "My first big React 19 project: GitHub Repo Manager with Gemini AI"

---

## Task 4: Content Marketing (Weeks 2-8)

> **Non-code tasks.** Blog posts and articles to drive SEO and awareness.

### Blog Posts (DEV.to + Hashnode + LinkedIn)

- [ ] **4.1: Technical deep-dive**
  - "How I Built an AI-Powered GitHub Dashboard with React 19, Gemini, and Tailwind v4"
  - Cover architecture decisions, challenges, lessons learned
  - Include code snippets and screenshots

- [ ] **4.2: Open-source journey**
  - "Why I Open-Sourced My Developer Tool (and How You Can Too)"
  - Business model explanation, community building
  - Link to GitHub repo

- [ ] **4.3: Azure DevOps migration article**
  - "The Complete Guide to Migrating from Azure DevOps to GitHub"
  - Pain points, how your tool solves them
  - Target: Enterprise developers considering migration

- [ ] **4.4: AI in developer tools**
  - "10 Ways AI Can Actually Help You Manage Your GitHub Repositories"
  - Practical examples from your tool
  - Target: Skeptics who think AI in devtools is hype

- [ ] **4.5: Tutorial series**
  - "Self-Host Your Own GitHub Dashboard in 5 Minutes with Docker"
  - Step-by-step, beginner-friendly
  - Great for SEO: targets "github dashboard self-hosted" searches

### LinkedIn Strategy

- [ ] **4.6: Weekly posts** (target: Engineering Managers, CTOs)
  - Building in public updates
  - Feature announcements
  - User stories (when available)
  - Technical insights
  - Tag relevant people and communities

---

## Task 5: Community Building (Weeks 2-12)

> **Non-code + some code tasks.**

- [ ] **5.1: Create Discord server**
  - Channels: #general, #support, #feature-requests, #showcase, #contributing
  - Welcome message with getting started guide
  - Add Discord link to README and landing page

- [ ] **5.2: GitHub Discussions**
  - Enable Discussions on the repo
  - Categories: Announcements, Q&A, Ideas, Show and Tell
  - Pin welcome post with roadmap

- [ ] **5.3: Create "good first issue" labels**
  - Identify 5-10 beginner-friendly tasks
  - Label with "good first issue" and "help wanted"
  - Write clear descriptions with pointers to relevant code

- [ ] **5.4: Create ROADMAP.md** (code task)

  Create `ROADMAP.md` in repo root:
  ```markdown
  # Roadmap

  ## Current Focus (v3.x)
  - [ ] GitLab import support
  - [ ] Bitbucket import support
  - [ ] Custom AI model selection (OpenAI, Claude, local)
  - [ ] Plugin system for community extensions
  - [ ] Mobile app (React Native)

  ## Recently Shipped
  - [x] AI-powered quality reports
  - [x] Azure DevOps migration wizard
  - [x] Team collaboration
  - [x] Stripe billing integration
  ```

- [ ] **5.5: Commit ROADMAP.md**

  ```
  docs: add public roadmap
  ```

- [ ] **5.6: Sponsor open-source projects**
  - Find 3-5 popular GitHub repos that could use your tool
  - Offer to manage/analyze their repos for free
  - Ask for a "Managed with GitHub Repo Manager" badge in return
  - Creates backlinks and social proof

---

## Task 6: Partnership & Distribution (Months 3-6)

> **Non-code tasks.** Strategic partnerships for wider reach.

- [ ] **6.1: GitHub Technology Partner Program**
  - Apply for GitHub's technology partner program
  - Enables listing in GitHub Marketplace with verified badge
  - Requires: functioning OAuth app, support system, documentation

- [ ] **6.2: DevOps conference submissions**
  - Submit talks to: DevOpsDays, GitHub Universe, ReactConf, local meetups
  - Topics: "AI-Powered DevOps", "Open-Source SaaS", "React 19 in Production"

- [ ] **6.3: Integration partnerships**
  - Reach out to complementary tools:
    - Linear/Jira (issue tracking)
    - Vercel/Netlify (deployment)
    - Slack (notifications)
  - Propose mutual integration and cross-promotion

- [ ] **6.4: Targeted outreach to companies migrating from Azure DevOps**
  - Monitor discussions on Reddit, Twitter, Stack Overflow about Azure → GitHub migration
  - Offer free Enterprise trial for migration use case
  - Write case study after successful migration

---

## Task 7: Ongoing Growth Metrics (Track Monthly)

> **Non-code.** KPIs to monitor.

| Metric | Month 1 Target | Month 3 Target | Month 6 Target |
|--------|----------------|----------------|----------------|
| GitHub Stars | 100 | 500 | 2,000 |
| Cloud Signups | 30 | 200 | 1,000 |
| DAU (Daily Active Users) | 10 | 50 | 200 |
| Paying Customers | 0 | 5 | 20 |
| MRR | $0 | $100 | $1,000 |
| Discord Members | 20 | 100 | 500 |
| Blog Post Views | 1,000 | 10,000 | 50,000 |

### Analytics to Set Up

- [ ] **7.1: Product analytics** — Plausible or PostHog on the cloud edition
- [ ] **7.2: GitHub insights** — Track traffic, clones, referrers on GitHub repo
- [ ] **7.3: Stripe dashboard** — Monitor MRR, churn, conversion rate
- [ ] **7.4: Social metrics** — Track followers, engagement on LinkedIn, Twitter, DEV.to

---

## Completion Checklist

- [ ] Landing page live (unauthenticated experience)
- [ ] SEO meta tags and OG images
- [ ] Demo video recorded
- [ ] Product Hunt launch completed
- [ ] Hacker News Show HN posted
- [ ] 3+ Reddit posts published
- [ ] 3+ blog posts published
- [ ] Discord community created
- [ ] GitHub Discussions enabled
- [ ] Good first issues labeled
- [ ] ROADMAP.md published
- [ ] Analytics tracking active
