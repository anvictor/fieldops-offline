# Task 006: Backend CI with PostgreSQL Integration Tests

## Goal

Extend pull-request CI so backend TypeScript compilation and the existing real-PostgreSQL integration suite run automatically alongside frontend validation.

## Constraints and allowed files

Change exactly these files:

- `.github/workflows/ci.yml`
- `docs/tasks/006-backend-ci.md`
- `docs/tasks/registry.json`

Preserve the `pull_request` trigger against `main`, read-only repository permissions, and the existing `validate` check name. Keep root `npm ci`, `npm run lint`, and `npm run build`. Do not change deployment, backend/frontend source, migrations, tests, dependencies/lockfiles, Compose, AGENTS.md, previous task specifications, local configuration, or unrelated files. Do not introduce secrets, `.env` files, Docker Desktop, Compose commands, failure suppression, or `continue-on-error` into CI.

## PostgreSQL service and environment

The existing Ubuntu `validate` job uses a GitHub Actions service named `postgres`, image `postgres:17-alpine`, mapped port `5432:5432`. Service environment sets database `fieldops_test`, user `fieldops_ci`, and password `fieldops_ci_only`. These are disposable CI-only values, not production credentials or repository secrets.

Docker health options run `pg_isready -U fieldops_ci -d fieldops_test`, with a 5-second interval, 3-second timeout, and 10 retries. GitHub Actions requires the service to become healthy before running job steps; exhausted readiness retries fail the job.

Job-level `TEST_DATABASE_URL` is `postgresql://fieldops_ci:fieldops_ci_only@localhost:5432/fieldops_test`, reaching the service through its published port. No environment file is created. The existing test suite creates its isolated schema, applies migrations, exercises the API, and cleans up; no separate workflow migration step is needed. GitHub Actions disposes of the service after the job.

## Acceptance criteria

1. Preserve the main PR trigger, `contents: read`, existing single `validate` job, and all frontend validation commands.
2. Install backend dependencies with `npm --prefix server ci` and run `npm run server:build`.
3. Provision PostgreSQL 17 with the disposable database, exposed port, and bounded `pg_isready` healthcheck described above.
4. Provide `TEST_DATABASE_URL` through workflow environment configuration without secrets or `.env` files.
5. Run `npm run server:test` against the actual service; service readiness failure and failing tests fail the PR check without suppression.
6. Keep deployment and all files outside the explicit allowlist unchanged.
7. Add TASK-006 with spec `docs/tasks/006-backend-ci.md`, branch `codex/006-backend-ci`, initially `in_progress` and null PR. After opening its implementation PR, set `in_review` and the actual PR number. Never set `done` in this PR; preserve earlier registry entries.
8. Validate YAML/structure, registry schema/references, exact change scope, and diff whitespace; run fresh root/backend installs, lint, frontend/backend builds, and local real-PostgreSQL tests when available. Inspect exact-head hosted CI and report its result accurately.
9. Complete implementer self-review, commit/push the feature branch, and open a PR against main. Do not merge; independent code review remains a separate gate.

## Validation and limitations

Before PR: `npm ci`, `npm --prefix server ci`, `npm run lint`, `npm run build`, `npm run server:build`, and `npm run server:test` with disposable PostgreSQL. Parse YAML and assert the configured trigger, permissions, steps, service, environment, and absence of failure suppression. Parse registry JSON, validate types/lifecycle/spec paths, preserve prior entries, and run `git diff --check`.

Local Docker CLI validation can exercise the same PostgreSQL image and credentials without Compose; it cannot replace hosted Actions validation. Readiness/test failure behavior follows GitHub Actions service startup and normal failing-step semantics; report whether deliberate hosted failure injection was performed. No application deployment or browser behavior is changed. Existing dependency audit findings are outside this three-file scope. Supplied independent requirements review: APPROVE REQUIREMENTS. No unresolved requirements questions.
