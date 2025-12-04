# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2025-12-03

### Added
- **Premium UI/UX**: Complete visual overhaul with Glassmorphism design system.
- **New Dashboard**: Interactive charts, skeleton loading states, and improved organization selector.
- **Enhanced OrgPanel**: Redesigned sidebar with search, view toggles, and user profile management.
- **Loading States**: Integrated `Skeleton` components for a smoother perceived performance.

### Changed
- Refactored `Dashboard` and `OrgPanel` to use `framer-motion` for complex animations.
- Updated `App.jsx` layout to support the new sidebar-based navigation structure.
- Improved organization selection logic to handle data refreshing more gracefully.

## [2.1.0] - 2025-12-02

### Added
- **AI Assistant**: Integrated Google Gemini Flash for intelligent repository management and chat.
- **Smart Descriptions**: "Magic Button" in Create Repo modal to auto-generate descriptions.
- **Dashboard Filtering**: Filter statistics and charts by specific organizations.
- **Enhanced UX**: Added `framer-motion` animations for smooth transitions and interactions.
- **AI Configuration**: Graceful error handling for missing API keys with helpful UI feedback.

### Fixed
- Resolved issues with organization data fetching in the Dashboard.
- Fixed server-side error handling for unconfigured AI endpoints.

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

