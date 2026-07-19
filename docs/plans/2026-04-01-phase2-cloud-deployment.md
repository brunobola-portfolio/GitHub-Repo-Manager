# Phase 2: Cloud Deployment & Infrastructure

> **⚠️ Superseded (historical plan).** This early plan targets Vercel + Railway +
> **PostgreSQL** + Redis. The shipped product is **SQLite-only** (a `postgres://`
> `DATABASE_URL` fails fast at boot) and the frontend/backend deploy is
> documented in [`docs/operations.md`](../operations.md), not Vercel. Read this
> for history only; follow the operations runbook for current deployment.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the platform to production with Vercel (frontend) + Railway (backend + PostgreSQL + Redis). Set up monitoring, logging, error tracking, and automated deployments.

**Spec:** `docs/specs/2026-04-01-platform-transformation-spec.md`

**Tech Stack:** Vercel, Railway, GitHub Actions, Sentry, Pino.

**Prerequisites:** Phase 1 complete (database abstraction, Redis support, config module).

---

## Parallelism Map

Tasks 1, 2 are independent — run in parallel.
Task 3 depends on Tasks 1 + 2.
Task 4 depends on Task 3.
Task 5 depends on Task 4.

---

## Task 1: Vercel Frontend Deployment

**Files:**
- Create: `vercel.json`
- Modify: `vite.config.js` (production API URL)
- Modify: `src/config.js` (environment-based API URL)

- [ ] **Step 1.1: Create vercel.json**

  ```json
  {
    "buildCommand": "npm run build",
    "outputDirectory": "dist",
    "framework": "vite",
    "rewrites": [
      { "source": "/api/:path*", "destination": "https://api.yourapp.com/api/:path*" }
    ],
    "headers": [
      {
        "source": "/(.*)",
        "headers": [
          { "key": "X-Content-Type-Options", "value": "nosniff" },
          { "key": "X-Frame-Options", "value": "DENY" },
          { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
        ]
      }
    ]
  }
  ```

  Note: Replace `api.yourapp.com` with actual backend domain after Railway deployment.

- [ ] **Step 1.2: Update frontend config for production API**

  Read `src/config.js`. Ensure the API base URL is configurable:

  ```js
  export const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';
  ```

  In Vercel, set environment variable `VITE_API_BASE_URL` to the Railway backend URL.

- [ ] **Step 1.3: Configure Vercel project**

  Via Vercel CLI or dashboard:
  1. Connect GitHub repository
  2. Set build command: `npm run build`
  3. Set output directory: `dist`
  4. Set environment variables:
     - `VITE_API_BASE_URL` = Railway backend URL
     - `VITE_MOCK_MODE` = `false`
  5. Enable automatic deployments on `main` branch

- [ ] **Step 1.4: Commit**

  ```
  feat(deploy): add Vercel configuration for frontend deployment
  ```

---

## Task 2: Railway Backend Deployment

**Files:**
- Create: `railway.toml`
- Create: `Procfile`
- Modify: `server/index.js` (startup logging, health check)

- [ ] **Step 2.1: Create railway.toml**

  ```toml
  [build]
  builder = "nixpacks"

  [deploy]
  startCommand = "node server/index.js"
  healthcheckPath = "/api/health"
  healthcheckTimeout = 10
  restartPolicyType = "on_failure"
  restartPolicyMaxRetries = 3

  [service]
  internalPort = 3001
  ```

- [ ] **Step 2.2: Create Procfile (alternative for Railway/Heroku)**

  ```
  web: node server/index.js
  ```

- [ ] **Step 2.3: Configure Railway services**

  In Railway dashboard:

  **Service 1: PostgreSQL**
  - Add PostgreSQL plugin
  - Note the `DATABASE_URL` (auto-injected)

  **Service 2: Redis**
  - Add Redis plugin
  - Note the `REDIS_URL` (auto-injected)

  **Service 3: API Server**
  - Connect GitHub repository
  - Set environment variables:
    - `NODE_ENV=production`
    - `PORT=3001`
    - `DATABASE_URL` (from PostgreSQL plugin)
    - `REDIS_URL` (from Redis plugin)
    - `SESSION_SECRET` (generate 64-char random string)
    - `GITHUB_CLIENT_ID` (from GitHub OAuth app for production)
    - `GITHUB_CLIENT_SECRET` (from GitHub OAuth app)
    - `FRONTEND_URL` (Vercel deployment URL)
    - `GEMINI_API_KEY` (optional)
  - Set start command: `node server/index.js`
  - Set health check: `/api/health`

- [ ] **Step 2.4: Create production GitHub OAuth App**

  On GitHub:
  1. Go to Settings → Developer settings → OAuth Apps → New
  2. Application name: "GitHub Repo Manager"
  3. Homepage URL: Vercel deployment URL
  4. Authorization callback URL: `https://api.yourapp.railway.app/api/auth/callback`
  5. Note Client ID and Client Secret

- [ ] **Step 2.5: Update CORS for production**

  Read `server/index.js`. Verify CORS configuration supports:
  - The Vercel frontend domain
  - `credentials: true` for cookies
  - Proper `sameSite` cookie settings for cross-origin

  If frontend and backend are on different domains, cookies need `sameSite: 'none'` and `secure: true`. Consider using a subdomain strategy instead (app.domain.com + api.domain.com).

- [ ] **Step 2.6: Commit**

  ```
  feat(deploy): add Railway configuration for backend deployment
  ```

---

## Task 3: Custom Domain Setup

**Depends on:** Tasks 1 + 2

- [ ] **Step 3.1: Register domain**

  Purchase a domain (e.g., `githubrepoManager.dev` or `repoManager.app`).

  Configure DNS:
  - `@` → Vercel (frontend)
  - `api` → Railway (backend)
  - Or use Vercel rewrites to proxy `/api/*` to Railway

- [ ] **Step 3.2: Update OAuth callback URL**

  Update the GitHub OAuth App callback URL to use the custom domain:
  `https://api.yourdomain.com/api/auth/callback`

- [ ] **Step 3.3: Update environment variables**

  - Vercel: `VITE_API_BASE_URL=https://api.yourdomain.com/api/v1`
  - Railway: `FRONTEND_URL=https://yourdomain.com`

- [ ] **Step 3.4: SSL verification**

  Verify both Vercel and Railway auto-provision SSL certificates for custom domains.

---

## Task 4: Monitoring & Error Tracking

**Depends on:** Task 3

**Files:**
- Modify: `package.json` (add Sentry)
- Create: `server/lib/monitoring.js`
- Modify: `server/index.js` (initialize monitoring)
- Modify: `src/main.jsx` (frontend error tracking)

- [ ] **Step 4.1: Install Sentry**

  ```bash
  npm install @sentry/node @sentry/react
  ```

- [ ] **Step 4.2: Create monitoring module**

  Create `server/lib/monitoring.js`:
  ```js
  import * as Sentry from '@sentry/node';

  export function initMonitoring() {
    if (process.env.SENTRY_DSN) {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV,
        tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      });
    }
  }

  export function captureError(error, context = {}) {
    if (process.env.SENTRY_DSN) {
      Sentry.captureException(error, { extra: context });
    }
    // Always log locally too
    console.error(error.message, context);
  }
  ```

- [ ] **Step 4.3: Initialize in server**

  Read `server/index.js`. Add `initMonitoring()` call at the very top, before Express app creation.

  Add Sentry error handler middleware after all routes:
  ```js
  app.use(Sentry.expressErrorHandler());
  ```

- [ ] **Step 4.4: Add frontend error tracking**

  Read `src/main.jsx`. Initialize Sentry for React:
  ```js
  import * as Sentry from '@sentry/react';

  if (import.meta.env.VITE_SENTRY_DSN) {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
    });
  }
  ```

  Wrap the existing ErrorBoundary with Sentry's error boundary.

- [ ] **Step 4.5: Enhance health check endpoint**

  Read `server/index.js`. Enhance `/api/health` to return:
  ```json
  {
    "status": "ok",
    "version": "2.5.0",
    "database": "connected",
    "redis": "connected",
    "uptime": 12345
  }
  ```

- [ ] **Step 4.6: Add .env.example entries**

  ```env
  # === Optional: Monitoring ===
  # SENTRY_DSN=https://your-sentry-dsn
  # VITE_SENTRY_DSN=https://your-frontend-sentry-dsn
  ```

- [ ] **Step 4.7: Commit**

  ```
  feat(monitoring): add Sentry error tracking and enhanced health checks
  ```

---

## Task 5: Deployment Pipeline

**Depends on:** Task 4

**Files:**
- Modify: `.github/workflows/ci.yml` (add deployment step)
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 5.1: Create deployment workflow**

  Create `.github/workflows/deploy.yml`:

  ```yaml
  name: Deploy

  on:
    push:
      branches: [main]

  jobs:
    test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 20
            cache: npm
        - run: npm ci
        - run: npx vitest run
        - run: npm run build

    deploy-backend:
      needs: test
      runs-on: ubuntu-latest
      if: github.ref == 'refs/heads/main'
      steps:
        - uses: actions/checkout@v4
        - uses: railwayapp/github-cli@v1
          with:
            railway_token: ${{ secrets.RAILWAY_TOKEN }}
            command: up --service api

    deploy-frontend:
      needs: test
      runs-on: ubuntu-latest
      if: github.ref == 'refs/heads/main'
      steps:
        - name: Trigger Vercel deployment
          run: curl -X POST ${{ secrets.VERCEL_DEPLOY_HOOK }}
  ```

  Note: Vercel auto-deploys from GitHub by default. The deploy hook is a fallback mechanism.

- [ ] **Step 5.2: Add required secrets to GitHub**

  Document the secrets needed in the repo:
  - `RAILWAY_TOKEN` — Railway API token
  - `VERCEL_DEPLOY_HOOK` — Vercel deploy webhook URL (optional)

- [ ] **Step 5.3: Commit**

  ```
  feat(ci): add automated deployment pipeline for Railway and Vercel
  ```

---

## Completion Checklist

- [ ] Frontend deployed on Vercel with custom domain
- [ ] Backend deployed on Railway with PostgreSQL + Redis
- [ ] Custom domain configured (app + api subdomains)
- [ ] GitHub OAuth app configured for production
- [ ] CORS and cookies working cross-origin
- [ ] Sentry error tracking (frontend + backend)
- [ ] Enhanced health check endpoint
- [ ] Automated deployment on push to main
- [ ] SSL certificates active
- [ ] All tests pass in CI before deploy
