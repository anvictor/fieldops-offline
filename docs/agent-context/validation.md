# Validation context

Required for validation, tests or CI. Use existing scripts and committed lockfiles;
do not invent a test command or silently skip prerequisites.

## Automated quality gates

Use Node.js 20.19+; install root and server dependencies with `npm ci` and
`npm --prefix server ci`. Run from repository root:

```sh
npm run lint
npm run build
npm run server:build
npm test
npm run server:test
```

Frontend build includes `tsc -b` and Vite production/PWA output. Backend build
compiles application and type-checks integration tests. Frontend Vitest tests in
`tests/sync.test.ts` use fake IndexedDB, simulated HTTP/clocks and shared Web Locks.
Backend `tsx`/Node integration tests in `server/tests/api.test.ts` use real
PostgreSQL. Both suites exist; no coverage threshold is configured.

For backend tests or database setup, read [server/README.md](../../server/README.md).
Use only a separate disposable database through `TEST_DATABASE_URL`; tests fail
if missing, create and remove unique schemas, and deliberately exercise safe
errors. Never use production/development data or expose credentials in evidence.
PR CI's existing `validate` job supplies PostgreSQL 17 and runs all five gates;
read `.github/workflows/ci.yml` when checking CI configuration or exact outcomes.

## Documentation and registry checks

For documentation work, check changed Markdown links, local target existence
and heading fragments, route conditions/ownership, and stale statements against
current source. Do not use link validation to recursively preload task history.
No dedicated documentation checker is installed; an external temporary checker
or explicit inspection can provide evidence without adding dependencies.

For registry updates, read [registry conventions](../tasks/README.md): parse JSON,
verify exact keys/types, schemaVersion, unique ID/numeric identity, allowed states,
existing repository-relative spec paths and branch/PR lifecycle invariants.
Compare historical entries and protected paths with main. Check actual GitHub
branch/PR references before asserting in_review/done; never predict completion.
Run `git diff --check` and inspect changed paths for scope compliance.

## Manual checks and evidence

For frontend behavior changes, verify create/status/delete/filter, reload
persistence, offline/online indicators and reconnect replay with safe errors.
Real-browser tests complement deterministic tests; cover multi-tab coordination,
Retry/Discard and browser Web Lock availability when synchronization changes.
For PWA/deployment changes, load frontend context and CONVENTIONS via the root
routes, verify shell caching after an initial visit, offline reopen and worker
updates without losing forms. This documentation-only refactor changes no runtime
behavior and does not require new browser scenarios or deployment before merge.

Record commands, outcomes and material limitations honestly. Before merge all
available gates and CI must pass along with reviews and acceptance criteria.
User-directed no-merge tasks stop with the PR open; green CI is not evidence of
post-merge deployment/live verification or registry completion.
