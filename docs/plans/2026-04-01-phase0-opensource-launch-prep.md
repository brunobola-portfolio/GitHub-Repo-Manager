# Phase 0: Open-Source Launch Preparation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the repository for public visibility as a professional open-source project. Add Docker support, community health files, clean environment configuration, and ensure the codebase is ready for external contributors.

**Spec:** `docs/specs/2026-04-01-platform-transformation-spec.md`

**Tech Stack:** React 19, Vite 7, Tailwind CSS v4, Express 5, better-sqlite3, Docker.

**Prerequisites:** None — this is the first phase.

---

## Parallelism Map

Tasks 1, 2, 3, 4 are fully independent — run in parallel.
Task 5 depends on Tasks 1-4 completing first.
Task 6 depends on Task 5.

---

## Task 1: Docker & Docker Compose

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

- [ ] **Step 1.1: Create .dockerignore**

  Create `.dockerignore`:

  ```
  node_modules
  .git
  .dev
  .claude
  .env
  .env.local
  server/data/*.db
  server/data/tmp/
  dist
  coverage
  *.log
  ```

- [ ] **Step 1.2: Create multi-stage Dockerfile**

  Create `Dockerfile` with multi-stage build:

  ```dockerfile
  # Stage 1: Build frontend
  FROM node:20-alpine AS builder
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci
  COPY . .
  RUN npm run build

  # Stage 2: Production
  FROM node:20-alpine AS production
  WORKDIR /app

  # Install only production deps + build tools for better-sqlite3
  RUN apk add --no-cache python3 make g++
  COPY package*.json ./
  RUN npm ci --omit=dev && apk del python3 make g++

  # Copy built frontend + server
  COPY --from=builder /app/dist ./dist
  COPY server ./server

  # Create data directory
  RUN mkdir -p server/data && chown -R node:node server/data

  # Environment
  ENV NODE_ENV=production
  ENV PORT=3001

  # Non-root user
  USER node

  EXPOSE 3001

  # Health check
  HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

  CMD ["node", "server/index.js"]
  ```

- [ ] **Step 1.3: Create docker-compose.yml**

  ```yaml
  version: '3.8'

  services:
    app:
      build: .
      ports:
        - "3001:3001"
      environment:
        - NODE_ENV=production
        - SESSION_SECRET=${SESSION_SECRET}
        - GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID}
        - GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET}
        - FRONTEND_URL=${FRONTEND_URL:-http://localhost:3001}
        - GEMINI_API_KEY=${GEMINI_API_KEY:-}
      volumes:
        - app-data:/app/server/data
      restart: unless-stopped

  volumes:
    app-data:
  ```

- [ ] **Step 1.4: Update server/index.js to serve static files in production**

  Read `server/index.js`. After all API routes are registered, add static file serving for the built frontend (only when `dist/` exists):

  ```js
  // Serve frontend in production
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(__dirname, '..', 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }
  ```

- [ ] **Step 1.5: Commit**

  ```
  feat(docker): add Dockerfile, docker-compose, and production static serving
  ```

---

## Task 2: Community Health Files

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `SECURITY.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.md`
- Create: `.github/ISSUE_TEMPLATE/feature_request.md`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`

- [ ] **Step 2.1: Create CONTRIBUTING.md**

  Write a concise contributing guide covering:
  - Prerequisites (Node 20+, npm)
  - Local setup (`npm install`, `npm run dev:all`)
  - Code style rules (JSX only, Tailwind, no global CSS)
  - Testing (`npx vitest`, `npx playwright test`)
  - PR process (conventional commits, one feature per PR)
  - Architecture overview (point to `docs/architecture/`)

- [ ] **Step 2.2: Create CODE_OF_CONDUCT.md**

  Use Contributor Covenant v2.1 (standard for open-source projects).

- [ ] **Step 2.3: Create SECURITY.md**

  Write security policy covering:
  - Supported versions
  - Reporting vulnerabilities (email, not public issues)
  - Response timeline expectations
  - Scope of security policy

- [ ] **Step 2.4: Create GitHub issue templates**

  Create `.github/ISSUE_TEMPLATE/bug_report.md`:
  - Description, steps to reproduce, expected vs actual behavior
  - Environment (OS, Node version, browser)
  - Screenshots

  Create `.github/ISSUE_TEMPLATE/feature_request.md`:
  - Problem description, proposed solution, alternatives considered

- [ ] **Step 2.5: Create PR template**

  Create `.github/PULL_REQUEST_TEMPLATE.md`:
  - Summary of changes
  - Type (feat/fix/refactor/docs)
  - Checklist (tests, lint, docs updated)

- [ ] **Step 2.6: Commit**

  ```
  chore(community): add CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, issue/PR templates
  ```

---

## Task 3: Environment Configuration Cleanup

**Files:**
- Create: `.env.example`
- Modify: `README.md` (update setup instructions)

- [ ] **Step 3.1: Create .env.example**

  Read `server/index.js` and all route files to collect every env var referenced. Create `.env.example`:

  ```env
  # === Required ===
  GITHUB_CLIENT_ID=your_github_oauth_app_client_id
  GITHUB_CLIENT_SECRET=your_github_oauth_app_client_secret
  SESSION_SECRET=generate_a_random_32_char_string_here

  # === Frontend ===
  FRONTEND_URL=http://localhost:5173

  # === Optional: AI Features ===
  GEMINI_API_KEY=your_google_gemini_api_key
  GEMINI_MODEL=gemini-2.5-flash

  # === Optional: Azure DevOps Migration ===
  AZURE_PAT=your_azure_devops_personal_access_token

  # === Optional: Webhooks ===
  WEBHOOK_SECRET=your_github_webhook_secret

  # === Server ===
  PORT=3001
  NODE_ENV=development
  ```

- [ ] **Step 3.2: Verify .gitignore includes .env files**

  Read `.gitignore`. Confirm `.env` and `.env.local` are listed. Add if missing.

- [ ] **Step 3.3: Update README.md setup section**

  Read `README.md`. Update the installation/configuration section to reference `.env.example`:
  - `cp .env.example .env`
  - Document each variable
  - Add Docker quick-start section

- [ ] **Step 3.4: Commit**

  ```
  chore(config): add .env.example and update setup documentation
  ```

---

## Task 4: Codebase Cleanup for Public Visibility

**Files:**
- Review and clean: all server files for hardcoded values
- Modify: `package.json` (verify public metadata)

- [ ] **Step 4.1: Audit for hardcoded secrets or internal references**

  Search the codebase for:
  - Hardcoded URLs that are internal/private
  - Hardcoded API keys or tokens
  - Internal email addresses or names in comments
  - Debug code or `console.log` statements that should be removed
  - `TODO` comments that reference internal systems

  Use: `grep -r "TODO\|FIXME\|HACK\|console.log\|localhost" server/ src/ --include="*.js" --include="*.jsx"`

- [ ] **Step 4.2: Verify package.json public metadata**

  Read `package.json`. Ensure:
  - `"homepage"` points to correct GitHub repo
  - `"repository"` URL is correct
  - `"bugs"` URL is correct
  - `"author"` is correct
  - `"license"` is "MIT"
  - `"description"` is compelling for npm/GitHub

- [ ] **Step 4.3: Verify LICENSE file exists and is correct**

  Check if `LICENSE` file exists at project root with MIT license text.

- [ ] **Step 4.4: Commit (if changes needed)**

  ```
  chore(cleanup): audit and clean codebase for public release
  ```

---

## Task 5: GitHub Actions CI/CD Pipeline

**Depends on:** Tasks 1-4

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/docker.yml`

- [ ] **Step 5.1: Create CI workflow**

  Create `.github/workflows/ci.yml`:

  ```yaml
  name: CI

  on:
    push:
      branches: [main]
    pull_request:
      branches: [main]

  jobs:
    lint:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 20
            cache: npm
        - run: npm ci
        - run: npm run lint

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

    build:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 20
            cache: npm
        - run: npm ci
        - run: npm run build
  ```

- [ ] **Step 5.2: Create Docker build workflow**

  Create `.github/workflows/docker.yml`:

  ```yaml
  name: Docker

  on:
    push:
      tags: ['v*']
    workflow_dispatch:

  jobs:
    build:
      runs-on: ubuntu-latest
      permissions:
        contents: read
        packages: write
      steps:
        - uses: actions/checkout@v4
        - uses: docker/setup-buildx-action@v3
        - uses: docker/login-action@v3
          with:
            registry: ghcr.io
            username: ${{ github.actor }}
            password: ${{ secrets.GITHUB_TOKEN }}
        - uses: docker/build-push-action@v6
          with:
            push: true
            tags: |
              ghcr.io/${{ github.repository }}:${{ github.ref_name }}
              ghcr.io/${{ github.repository }}:latest
            cache-from: type=gha
            cache-to: type=gha,mode=max
  ```

- [ ] **Step 5.3: Commit**

  ```
  feat(ci): add GitHub Actions CI pipeline and Docker build workflow
  ```

---

## Task 6: Validation & Final Review

**Depends on:** Task 5

- [ ] **Step 6.1: Run full test suite**

  ```bash
  npx vitest run
  npm run lint
  npm run build
  ```

  All must pass.

- [ ] **Step 6.2: Test Docker build locally**

  ```bash
  docker build -t github-repo-manager .
  docker run -p 3001:3001 -e SESSION_SECRET=test-secret-32-chars-minimum-here -e NODE_ENV=production github-repo-manager
  ```

  Verify health endpoint responds: `curl http://localhost:3001/api/health`

- [ ] **Step 6.3: Review all new files**

  Verify:
  - No secrets in any committed file
  - All community health files render correctly on GitHub
  - Docker build produces a working image
  - CI workflow syntax is valid

- [ ] **Step 6.4: Final commit (if needed)**

  ```
  chore(phase0): complete open-source launch preparation
  ```

---

## Completion Checklist

- [ ] Docker support (build, run, compose)
- [ ] CONTRIBUTING.md
- [ ] CODE_OF_CONDUCT.md
- [ ] SECURITY.md
- [ ] Issue and PR templates
- [ ] .env.example with all variables documented
- [ ] No hardcoded secrets in codebase
- [ ] CI/CD pipeline (lint, test, build, Docker)
- [ ] README updated with Docker quick-start
- [ ] All tests pass
