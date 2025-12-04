# Contributing to GitHub Repo Manager

First off, thanks for taking the time to contribute! 🎉

The following is a set of guidelines for contributing to GitHub Repo Manager. These are mostly guidelines, not rules. Use your best judgment, and feel free to propose changes to this document in a pull request.

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to [bruno@bolalabs.com](mailto:bruno@bolalabs.com).

## How Can I Contribute?

### Reporting Bugs

This section guides you through submitting a bug report. Following these guidelines helps maintainers and the community understand your report, reproduce the behavior, and find related reports.

- **Use a clear and descriptive title** for the issue to identify the problem.
- **Describe the exact steps which reproduce the problem** in as many details as possible.
- **Provide specific examples** to demonstrate the steps. Include links to files or GitHub projects, or copy/pasteable snippets, which you use in those examples.

### Suggesting Enhancements

This section guides you through submitting an enhancement suggestion, including completely new features and minor improvements to existing functionality.

- **Use a clear and descriptive title** for the issue to identify the suggestion.
- **Provide a step-by-step description of the suggested enhancement** in as many details as possible.
- **Explain why this enhancement would be useful** to most GitHub Repo Manager users.

### Pull Requests

The process described here has several goals:

- Maintain the quality of GitHub Repo Manager.
- Fix problems that are important to users.
- Engage the community in working toward the best possible GitHub Repo Manager.

1.  Fork the repo and create your branch from `main`.
2.  If you've added code that should be tested, add tests.
3.  If you've changed APIs, update the documentation.
4.  Ensure the test suite passes.
5.  Make sure your code lints.
6.  Issue that pull request!

## Styleguides

### Git Commit Messages

- Use the present tense ("Add feature" not "Added feature")
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit the first line to 72 characters or less
- Reference issues and pull requests liberally after the first line

### JavaScript Styleguide

- All JavaScript must adhere to [Standard JS](https://standardjs.com/).
- Prefer `const` over `let`.
- Use async/await for asynchronous operations.

## Development Setup

1.  Clone the repository
2.  Install dependencies: `npm install` (root) and `cd server && npm install`
3.  Create `.env` files in root and server directories based on examples.
4.  Start development server: `npm run dev`

Happy coding! 🚀
