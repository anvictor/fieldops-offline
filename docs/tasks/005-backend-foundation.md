# Task 005: REST API and PostgreSQL Foundation

## Goal

Introduce an isolated Node.js/TypeScript Express REST/JSON API with PostgreSQL persistence. Build the backend foundation without connecting the existing React Worker PWA or its pending sync queue.

## Constraints and boundaries

Preserve the existing frontend, Workbox configuration and GitHub Pages base/deployment, IndexedDB schema/version, inspection UI/CRUD/filtering, sync queue semantics, OnlineStatus Context, reconnect logging, `.codex/config.toml`, and unrelated local edits/files. No synchronization, authentication/RBAC, conflict resolution, or public backend deployment is introduced.

## Acceptance criteria

1. Backend lives under `server/`, using Node.js, TypeScript, Express, PostgreSQL, and environment configuration.
2. `GET /api/health` clearly reports API liveness as JSON.
3. PostgreSQL-backed `GET /api/inspections`, `GET /api/inspections/:id`, `POST /api/inspections`, `PATCH /api/inspections/:id`, and `DELETE /api/inspections/:id` work.
4. Inspections expose server-generated UUID `id`, `title`, `status` (`draft | completed`), `createdAt`, and `updatedAt`.
5. Versioned SQL migrations create the table reproducibly; migration reruns preserve data.
6. Docker Compose starts local PostgreSQL with persistent storage and loopback binding; a safe example environment file and setup instructions are supplied.
7. Inputs are validated, SQL values parameterized, HTTP codes appropriate, and errors consistently JSON without raw stack traces or secrets.
8. Backend development/build/start/migration/test commands are documented and convenient.
9. Repository lint, existing frontend build, backend TypeScript/build checks, and deterministic real-PostgreSQL API tests pass. Tests verify CRUD, persistence, migration reruns, invalid requests, and safe errors.
10. Existing frontend source, PWA, IndexedDB, connectivity, queue behavior, and deployment remain unchanged.
11. TASK-005 follows task registry conventions: feature branch and implementation PR against main; `in_progress` during implementation, then `in_review` with its actual PR number. Never predict `done`.
12. Implementer self-review reports evidence and limitations; designated independent Agent B review and merge gates remain separate. Do not merge this task automatically.

## API decisions

Titles are trimmed, 1–200 Unicode characters, with no null characters. Create requires title and defaults status to draft. PATCH requires title and/or status; other fields are rejected. IDs/timestamps cannot be supplied by clients. Responses use inspection objects or an ordered array; errors use `{ "error": { "code": "...", "message": "..." } }`. Create returns 201, reads/updates 200, delete 204, invalid requests 400, missing resources 404, unsupported media 415, oversized bodies 413, and unexpected failures 500. Health reports process liveness, not database readiness.

## Allowed files

- `server/`: application, packages/lockfile, TypeScript configuration, migrations, tests, Compose, example environment, backend README.
- Root `package.json`, `eslint.config.js`, and `.gitignore`: minimal backend script/lint/configuration integration.
- This specification and `docs/tasks/registry.json` (new TASK-005 entry only).

All other files, including AGENTS.md, prior task entries/specifications, application source, PWA assets/configuration, deployment workflows, local configuration, and existing HTML files, are outside implementation scope.

## Assumptions and questions

The API binds to loopback by default and remains separate from GitHub Pages. List pagination, public hosting, authentication, and browser CORS integration are deferred. Docker or another actual PostgreSQL runtime is required to claim database test success; an unavailable runtime must be reported. No blocking product questions remain after independent requirements interpretation.

## Validation and completion

Run `npm run lint`, `npm run build`, `npm run server:build`, and `npm run server:test` with a disposable PostgreSQL test database. Validate Compose configuration, registry structure/references, changed-file scope, and preservation of unrelated local files. Review every criterion before opening the PR. Record exact commit, validation evidence, and limitations in the PR. After implementation merge and required completion verification, a separate registry-only reconciliation PR may record `done` while retaining implementation branch/PR references.
