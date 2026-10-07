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
updates without losing forms. Choose scenarios according to the active task; documentation-only work does not
by itself require new runtime tests.

Record commands, outcomes and material limitations honestly. Before merge all
available gates and CI must pass along with reviews and acceptance criteria.
User-directed no-merge tasks stop with the PR open; green CI is not evidence of
post-merge deployment/live verification or registry completion.

## Exact-head merge evidence

Before merge, compare the current PR head, Agent B's persisted approval SHA and
required CI evidence: all must identify the same exact final head. Inspect the
GitHub run/check status and SHA; do not claim a check passed without that evidence.
Any head change invalidates implementation or reconciliation approval; obtain
Agent B re-review and successful required CI for the new head before merging.
A prior green run or chat-only review summary is insufficient. Use the
[workflow procedure](workflow.md#independent-review-evidence) when verifying review
attribution and permalinks. This documents a manual gate, not new CI automation.


## Production API foundation checks

For API/security/container changes, load server/README.md and backend context.
Backend Node tests also cover fail-closed configuration and HTTP auth/CORS ordering,
plus real-PostgreSQL production CRUD/replay. Verify the built non-root image with
throwaway runtime secrets and disposable DB: migrations/reruns, liveness, denied
access and authenticated CRUD. Ports published locally must bind loopback.
Do not print env/credentials, disable certificate verification or equate container
smoke tests with a real hosted public deployment. Record hosting/TLS/client rollout
prerequisites separately. CI runs backend tests; local Docker smoke is extra evidence.


## Deployed PWA browser gate

Read [README commands](../../README.md#automated-production-pwa-checks) for setup,
local/hosted targets and limitations. `npm run test:live` uses pinned development
Playwright/Chromium and requires `SMOKE_EXPECTED_SHA`. PR CI writes the generated
marker after building and checks a loopback production preview; Pages adds the
same smoke against its real deployment URL after deploy. Smoke has contents-read
permissions only, no credentials, fresh synthetic storage and pre-startup API guards.
The script first proves renderer and service-worker request isolation against a
disposable loopback fixture. Inspect the report's target, expected/observed SHA,
verdict and checks; preview evidence is not hosted evidence. The marker is not
precached; bounded uncached retries fail on stale/malformed versions.

For completion, inspect the whole Pages workflow for the exact merge SHA, including
its deployed smoke job, and persist run/report outcomes in the implementation PR.
Deployment-job success alone is insufficient. Artifacts contain synthetic screenshots
and compact reports, retained seven days; no environment, headers or full traces.
Covered hosted checks can provide direct live evidence; changed features require
appropriate additional checks and root gates remain mandatory. Backend end-to-end
sync, credential UX and browser connectivity indicator accuracy are not covered.
