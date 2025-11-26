# Contributing to GitHub Repo Manager

Thank you for your interest in contributing! This project is open source under the MIT License and welcomes improvements from the community.

## Code of Conduct

Be respectful, constructive, and kind. Assume good intent and collaborate in good faith.

## Getting Started

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/github-repo-manager.git
   cd github-repo-manager
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Create a feature branch**:
   ```bash
   git checkout -b feat/my-feature
   ```

## Development Workflow

- Start the full dev environment:
  ```bash
  npm run dev:all
  ```
- Frontend runs on `http://localhost:5173`.
- Backend API runs on `http://localhost:3001`.

Before opening a PR:

- Ensure **lint** passes:
  ```bash
  npm run lint
  ```
- Optionally run a production **build**:
  ```bash
  npm run build
  ```

## Commit Messages

This project uses **Conventional Commits** for a readable history and better tooling support.

Examples:

- `feat(ui): add bulk archive button to repo table`
- `fix(api): handle GitHub 403 rate limit responses`
- `docs: update README with Azure import notes`
- `chore: bump dependencies`

## Coding Guidelines

- Use **React functional components** and **hooks**.
- Keep **stateful logic** in hooks (e.g. `useGitHub`, `useTheme`, `useToast`) and keep components mostly presentational.
- Respect the existing **dark/light theme** implementation and ensure new UI elements work in both themes.
- Do not commit secrets. Use `.env` locally and follow `.env.example`.
- Prefer small, focused components with clear responsibilities.
- Keep API error messages user-friendly and avoid leaking sensitive details.

## Adding Features

When adding a feature:

1. Discuss large changes first via an issue or draft PR.
2. Include any necessary updates to **README**, **CHANGELOG**, or `docs/`.
3. Add or update tests if/when a test harness is added.

## Pull Requests

- Keep PRs focused and reasonably small.
- Describe **what** you changed and **why**.
- Mention any breaking changes or migration steps.

Thank you again for contributing to GitHub Repo Manager!

