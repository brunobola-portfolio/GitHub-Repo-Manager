# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-11-26

### Added
- Dark/Light theme support with persistent user preference and system-theme awareness.
- Dashboard view with repository statistics and organization overview.
- Organization management panel and modal for viewing and editing org details.
- Azure DevOps import flow for migrating repositories into GitHub.
- Activity sidebar for tracking the status and history of bulk operations.

### Changed
- Improved table, sidebar, and modal styling for better accessibility and dark-mode contrast.
- Centralized GitHub data fetching, pagination, and actions into the `useGitHub` hook.
- Added robust API utilities with retry logic, exponential backoff, and rich error types.
- Reduced unauthenticated API noise by skipping repo calls when the user is not logged in.
- Cleaned up ESLint issues and aligned the codebase with shared React/Node lint rules.

## [1.0.0] - 2025-10-01

### Added
- Initial GitHub Repo Manager release.
- GitHub OAuth authentication and session-based backend.
- Repository listing with pagination and bulk selection.
- Bulk operations: change visibility, transfer to organization, mirror (fork), archive, and delete.
- Basic activity log and feedback for long-running operations.

[2.0.0]: https://github.com/your-username/github-repo-manager/releases/tag/v2.0.0
[1.0.0]: https://github.com/your-username/github-repo-manager/releases/tag/v1.0.0

