# Task 001: Pull Request CI Validation

## Goal

Add GitHub Actions validation for pull requests so code quality and build failures are detected before merge.

## Constraints

- Limit implementation to CI configuration and follow existing repository conventions.
- Preserve the existing GitHub Pages deployment behavior.
- Do not introduce a test framework or implement application changes.
- This document records the task specification only; creating it does not authorize CI implementation.

## Acceptance Criteria

1. CI runs when pull requests targeting `main` are opened or updated.
2. CI installs dependencies using `npm ci`.
3. CI runs `npm run lint` and `npm run build`; the build includes TypeScript checks.
4. Validation failures appear as failed pull request checks.
5. Pull request validation does not deploy the application.

## Files That May Change During Implementation

- `.github/workflows/ci.yml` — add a workflow for pull request validation.

## Files That Must Not Change During Implementation

- Application source, including hooks and IndexedDB schema.
- Styles and assets.
- Dependency manifests and lockfile.
- The existing deployment workflow, `.github/workflows/deploy.yml`.

## Assumptions

- `main` is the intended pull request target branch.
- Existing npm scripts provide the required validation; no test framework will be introduced.
- Making checks mandatory through branch protection is outside this task's scope.

## Unresolved Questions

None are blocking under these assumptions. Inspect the existing workflow and runtime configuration before implementation to confirm compatibility.

## Validation and Review

Follow the mandatory development workflow in `AGENTS.md`, including independent requirements review, implementer self-review, independent code review, and deterministic validation before merge. Verify each acceptance criterion and report validation results, assumptions, and known limitations in the pull request. Do not merge until the required reviews approve and CI is green.
