# Task 007: Client-server Synchronization for Inspections

## Goal and delivery contract

Connect the offline-first React PWA's IndexedDB queue to the existing REST API for local-development CREATE, UPDATE and DELETE synchronization. Provide ordered, retryable, at-least-once delivery; never claim exactly-once HTTP delivery. GitHub Pages remains an offline-capable PWA without a public backend.

Independent requirements review supplied before implementation: APPROVE REQUIREMENTS. Assume one logical writer per inspection. Authentication, RBAC, public hosting, server-to-local synchronization/initial download, multi-device conflict resolution, version vectors, last-write-wins and server-side mutation fencing are excluded.

## Allowed files and preserved boundaries

Only change files when required:

- This specification and `docs/tasks/registry.json` (new TASK-007 entry only).
- `src/db.ts`, `src/App.tsx`, `src/App.css`, `src/api.ts`, `src/sync.ts`, and focused synchronization test files.
- `server/src/app.ts`, `server/src/validation.ts`, `server/tests/api.test.ts`.
- `vite.config.ts`, `package.json`, `package-lock.json`, `vitest.config.ts` if needed, `.github/workflows/ci.yml`, `README.md`, `server/README.md`.

Never change deployment workflow, PostgreSQL migrations, Compose, connectivity Context/provider/hook contract, PWA manifest/icons/service-worker strategy, AGENTS.md, CONVENTIONS.md, previous task specifications or TASK-001–006 entries, `server/.env`, `.codex/config.toml`, or unrelated local files. Vitest is permitted; no other test configuration file is needed.

## Backend API acceptance criteria

1. POST optionally accepts a client UUID `id`. Omission retains generated UUID behavior; invalid supplied UUID returns safe 400 JSON.
2. A new client ID creates the exact ID with 201. Same ID and same normalized title/status returns existing inspection with 200; differing content returns 409 `ID_CONFLICT`. Trim/validate titles using existing rules; omitted status becomes draft before comparison. Concurrent same-ID POSTs are safe without leaking database errors.
3. Missing inspection GET/PATCH/DELETE returns 404 `INSPECTION_NOT_FOUND`; unknown routes retain `NOT_FOUND`. Frontend PATCH missing is permanently blocked; DELETE is confirmed only by 204 or verified JSON 404 `INSPECTION_NOT_FOUND`, never generic/proxy/malformed 404.

## IndexedDB and delivery acceptance criteria

4. Upgrade v1 to v2 preserving existing stores/data. Add only durable sequence metadata. Allocate a monotonic safe integer sequence transactionally with the local mutation, queue insertion and metadata advance. No expiring leases.
5. Preserve v1 queue entries. Process all legacy entries first, sorted by createdAt then ID (ascending); historical insertion order cannot be reconstructed. Sequenced entries follow by sequence, independent of timestamps.
6. Never compact operations. Under synchronization exclusion load the oldest item, send its immutable queued snapshot, validate the acknowledgment, remove only that item in a committed IndexedDB transaction, refresh pending count, and continue. Pick up new queue items during an active run when practical. Never overwrite newer local data with server responses.
7. Use exclusive Web Lock `fieldops-inspection-sync` across all live same-origin runners. Entire processing/acknowledgment lifecycle stays inside its callback. Overlapping triggers do not create concurrent processors. Local promise tracking is only coalescing, never the lock. Aborted/lost runners must not begin acknowledgment/removal.
8. Missing Web Locks disables sync, preserves queue/data and displays exactly `Synchronization unavailable in this browser`. No fallback locking. Web Locks cannot fence a stale server request surviving browser-context termination; document this residual limitation.

## Configuration, failures and triggers

9. Development requests are relative `/api`; Vite proxies `/api` to `http://127.0.0.1:3001`. Production uses optional `VITE_API_BASE_URL`, an origin/base without `/api`, e.g. `https://api.example.com`. Normalize trailing slash; allow only HTTP(S), reject credentials/query/fragment. Missing/invalid production configuration disables sync without requests and preserves pending operations. Configuration does not guarantee reachability, CORS, HTTPS compatibility, authorization or backend availability.
10. Each request times out at 8000ms. Initial attempt plus two retries, with 500ms then 1000ms delays, only for network errors/timeouts/HTTP 5xx. HTTP 400, 409 conflicts, PATCH missing, unexpected/malformed acknowledgments and all other unhandled non-success responses are permanent retained failures.
11. First retained failure stops FIFO and keeps failed/following items; expose safe error state. Trigger on online startup, offline→online, queued local mutation while online, and Retry. No requests without available configuration.
12. UI exposes pending count, syncing, error, unavailable, Retry and permanent blocked-item Discard. Discard requires explicit confirmation and the same Web Lock; reread/recheck presence after acquiring it, remove only the queue entry, never local inspection data. Warn that discarding CREATE may block later UPDATE/DELETE. Never discard automatically.
13. New frontend titles use trim, 1–200 Unicode characters, no null character. Invalid legacy items remain and visibly block FIFO.
14. Cross-tab BroadcastChannel messages notify queue changes only, never lock ownership or trusted counts. Receivers reread IndexedDB pending count.
15. Keep App orchestration readable with focused API and synchronization modules; preserve reconnect pending-queue logging and existing inspection/filtering/offline persistence behavior.

## Tests and validation

Frontend deterministic tests cover: CREATE→UPDATE→DELETE; durable sequence versus timestamps; legacy createdAt/ID order; lost-response replay and idempotent 200; conflict 409; PATCH missing and repeated DELETE; untrusted 404; network/timeout/5xx exhaustion and exact timing; permanent validation failures; retained FIFO; acknowledgment-only deletion and IndexedDB acknowledgment failure; additions during sync; overlapping triggers/two runners; abort/lost runner; discard confirmation/lock/recheck; unsupported Web Locks; configuration normalization/rejection; cross-tab count refresh; state transitions. Test atomic mutation/sequence rollback and immutability too.

Extend real PostgreSQL tests for client/generated UUIDs, normalized/default-status replay, conflicts, concurrent same-ID POSTs, inspection-specific 404, and generic route 404.

CI retains the single `validate` check, frontend/backend installs, lint, both builds and PostgreSQL tests; add frontend synchronization tests without weakening gates. Run fresh installs as needed, lint, frontend build, backend build, frontend tests, disposable PostgreSQL tests, local end-to-end checks, diff whitespace, registry/schema/lifecycle/path checks, exact changed-file scope and implementer self-review before PR.

Local end-to-end verification must demonstrate React/Vite → relative /api proxy → API at 127.0.0.1:3001 → PostgreSQL, offline CRUD/pending persistence, reconnect delivery/ack removal, backend failure retention, reload local persistence, Retry, visible permanent failure, and Pages without a public API. Preserve existing `server/.env` byte-for-byte; never disclose or commit credentials. Report runtime limitations honestly, including whether outage behavior was injected or an actual process was stopped.

## Lifecycle

Use branch `codex/007-client-server-sync`. TASK-007 begins `in_progress` with null PR; after opening the implementation PR against main, record `in_review` and its actual number. Never mark done in the implementation PR. Commit/push only scoped work; inspect exact-head hosted logs to confirm both frontend sync and PostgreSQL tests actually ran. Leave independent code review to Agent B. Do not merge or delete the branch. Completion requires later post-merge verification and separate reconciliation.
