# FieldOps on Render and Neon

The deployment is a private single-owner demo: a free Render static PWA, a free
Render Node API and PostgreSQL on a confirmed Neon Free project. Keep the existing
Pages PWA and `/fieldops-offline/` scope. No paid resources may be provisioned
without the owner's separate approval. `render.yaml` describes only Render services;
it does not provision or upgrade Neon.

## Neon project setup

The existing deployment uses project `purple-union-67603644`, dedicated branch
`fieldops-render`, AWS Ohio (`aws-us-east-2`) and PostgreSQL 18. The observed plan at
TASK-016 verification was `free_v3`; runtime pooling and fixed 0.25 CU were verified.
Do not create another project or change infrastructure merely to run the public demo.

Neon Free rejected custom suspend interval settings (HTTP 412); observed endpoint
metadata was 0. The provider-managed policy was retained, without claiming a custom
five-minute schedule or a paid upgrade. Confirm current quotas/plan through the
owner's Console before any future infrastructure change.

Public entry points:
- [Render PWA](https://fieldops-offline.onrender.com/fieldops-offline/)
- [Anonymous API health](https://fieldops-api-g9z6.onrender.com/api/health)
- [Pages offline demo](https://anvictor.github.io/fieldops-offline/)

[TASK-016 authenticated live evidence](https://github.com/anvictor/fieldops-offline/pull/36#issuecomment-6127099422)
records direct browser → protected API → Neon creation, updates, offline replay,
credential lifecycle and synthetic cleanup on 2026-10-12. This is historical
verification, not a promise that a health response proves synchronization now.
See the [v1 demo](v1-demo.md) for a token-free presentation.

Confirm actual plan/quotas before infrastructure changes. Use an isolated FieldOps
branch/database; development and tests must not use production. Use Neon-provided
pooled connection for API traffic, direct connection for migrations, with verified
TLS (`sslmode=verify-full`). Do not set `rejectUnauthorized: false`, `sslmode=no-verify`
or disable TLS. Retain the existing `pg` driver, max 10 connections and 5-second
connection timeout. See [Neon projects](https://neon.com/docs/manage/projects)
and [pooling](https://neon.com/docs/connect/connection-pooling).

## Runtime configuration and release

Set secrets through Render Environment settings or connected secret-handling tools,
never public build variables, Git files, API URLs or chat. The API needs:

- `DATABASE_URL`: pooled Neon URL, verified TLS.
- `MIGRATION_DATABASE_URL`: direct URL to the same database, verified TLS.
- `API_TOKEN`: cryptographically random 32-byte base64url token (43 characters).
- `CORS_ORIGINS`: actual canonical HTTPS Render PWA origin, optionally the existing
  `https://anvictor.github.io`. No paths, wildcards or trailing slash.
- `NODE_ENV=production`, `API_MODE=production`, `HOST=0.0.0.0`; Render supplies PORT.

Build API with `npm ci --include=dev && npm run build` from `server/`.
Start with `sh release.sh`, which explicitly migrates using the direct URL and then
executes `node dist/index.js` with the pooled URL. Migration failure prevents startup;
the existing transaction/ledger/advisory lock makes concurrent runners and reruns safe.
Migrations do not run during build, and applied migration files remain unchanged.
Health check is `/api/health` (process liveness only).

Build the static service with `npm ci && npm run build && node scripts/render-static.mjs`;
publish `dist/render`. It nests the shell at `/fieldops-offline/`, writes the actual
`RENDER_GIT_COMMIT` marker and includes a root link/redirect fallback. Only
`VITE_API_BASE_URL` is frontend build configuration: actual HTTPS API origin without
`/api`, query, credentials or fragment. No owner token is built into this site.
Blueprint routes/headers provide CDN redirect, subpath fallback and marker no-store.
When using limited direct-creation tools, verify deployed assets/manifest/worker and
CDN cache behavior, and apply remaining Blueprint settings in Dashboard if needed.

## Owner connection

Enter the API's private owner token in the PWA password field and press Connect.
This sends the existing queued operations to that configured API. Anyone holding
the token can access the same server inspection data: do not distribute it as a
recruiter credential. There are no separate accounts, general concurrent-edit conflict resolution or exactly-once delivery. Connected devices may receive activity-driven snapshots and explicit server deletions.

The token lives only in the tab's memory; no durable browser store, queue, export,
URL or log contains it. Reloading and Disconnect clear it. Offline local CRUD
continues without it. 401/403 retain operations and require reconnect/permission
correction, not Discard. Disconnect aborts the current run and prevents subsequent
sends; a request already received by the server may still finish. Replay remains
at least once with idempotent CREATE. Each tab must connect separately.

## Free-demo limits and operations

Free hosting has service sleep/cold starts and account-level build/bandwidth quotas.
The client's bounded timeout retains operations after a slow wake-up; let the API
wake and press Retry. No paid always-on service or quota increase is authorized.
Check Render and Neon Usage regularly and pause operation before exhausting included
quotas. Do not enable paid add-ons or auto-upgrade for this demo.

Production API enforces a shared in-memory cap of 600 authenticated non-health requests/minute
after authentication/CORS and before body parsing/database work. Exact GET health is excluded; authenticated HEAD/unknown routes count. Anonymous/denied requests retain their 401/403 guards. The counter has fixed memory, resets on process restart, and is not a
distributed/per-user limit. Render ingress protection and this cap do not guarantee
protection from all denial-of-service. Existing 16 KiB body and pool limits remain.
Keep the private demo below 1,000 inspections and low concurrency; monitor row/storage
counts. Collection reads remain unpaginated; this dataset bound is operational,
not a database constraint or invitation to delete user data automatically.

Inspect Neon Free history/restore limits for the selected project. Before important
changes, export the DB via `pg_dump` over the direct verified-TLS connection into
owner-controlled encrypted storage; protect the export as private data. Test restores
only into an isolated branch/database. Browser JSON export backs up local inspections,
not the complete server database. Retain previous deployed commit/config for rollback;
schema rollback is not automatic and applied SQL is never rewritten. Do not delete
branches/data or rotate production secrets merely to finish tests.

## Evidence and completion

All five repo gates and exact-head independent review/CI are mandatory. Existing
Pages production smoke continues to prove offline PWA behavior with API writes
blocked. `scripts/auth-browser-smoke.mjs` separately runs virtual HTTPS origins routed
to loopback fixtures with actual disposable PostgreSQL; it proves owner-entry/auth
failure/reconnect/update/delete/reload/tab isolation but is explicitly local evidence.
Use only `TEST_DATABASE_URL`, no production DB, screenshots with populated token fields,
traces, request headers or credentials in artifacts.

For each deployment, record exact Render/Pages SHA/run/status in its implementation PR. UI-only changes use guarded presentation/PWA checks plus the disposable local auth fixture; they do not require distributing the owner credential. Revalidate actual authenticated synchronization when transport/backend behavior changes.
For backend/transport releases or new authenticated production verification, check
actual HTTPS health, anonymous 401, forbidden Origin 403, authenticated synthetic
CRUD/replay and cleanup. Then use fresh synthetic browser storage to enter the runtime
token, create/update inspections, verify corresponding Neon rows, queue offline
changes/reconnect and delete only those synthetic rows. Record direct hosted evidence
separately from local tests. A health response or green build is not full sync evidence.
TASK-016 was reconciled to done by [PR #37](https://github.com/anvictor/fieldops-offline/pull/37) after its successful deployment/live checks. Subsequent tasks follow the same reviewed completion gates.


### TASK021 rollout order

Deploy API/migration002 first using the existing release.sh migration step. The additive tombstone table protects retired UUIDs from late CREATE replay; existing clients keep CRUD response compatibility. Verify backend liveness and anonymous snapshot401 without fetching secrets or changing production inspections. Then deploy the frontend snapshot/activity client and verify its exact build marker/anonymous offline behavior. Authenticated two-device mutation proof belongs to disposable PostgreSQL/browser fixtures; live same-owner device verification is user-operated. No metadata-only frontend deploy or credential rotation is required.
