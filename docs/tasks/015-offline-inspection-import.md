# TASK-015: Safe offline inspection import

## Goal and authority

Restore or transfer exported inspection JSON into this browser, offline, with
validation and preview before explicit confirmation. Add new records only; never
replace existing data. User authorized autonomous feature selection, implementation,
checks, working comments, reviewed PR merges, deployment verification and registry
completion; no new cost or important-data deletion. Current main
`8d04e0739f1bc5d4e20c8ee8b8879e235203fb9f` is authoritative.
Branch `codex/015-offline-inspection-import`.
Read [AGENTS](../../AGENTS.md) → [registry](registry.json) → this specification →
[workflow](../agent-context/workflow.md), [frontend](../agent-context/frontend.md),
[validation](../agent-context/validation.md), [lifecycle](README.md),
[README](../../README.md), [conventions](../../CONVENTIONS.md). Do not preload history.

## Acceptance criteria and agreed design

1. Accept the existing export format only: exactly format=fieldops-inspections,
   schemaVersion=1, canonical ISO exportedAt and inspections array, with exact
   id/title/status record keys. UUID syntax matches existing API, normalize IDs to
   lowercase; titles use existing trim/1–200 Unicode/no-null rules; statuses draft
   or completed. Reject malformed JSON/structure/version, duplicate IDs within the
   file (including case variants), invalid rows and oversized input entirely.
   Bound file/text UTF-8 size to 2 MiB and array length to 1000 records; reject before
   reading oversized File objects. No new dependencies, arbitrary file execution,
   HTML rendering, network upload or diagnostic inclusion of private file content.
2. Accessible file input, safe errors and preview of total/new/skipped counts and
   at most five validated titles/statuses. Preview is read-only. Explicit Import
   new inspections confirms; Cancel clears preview without writes. A newer selection,
   cancellation or unmount invalidates older asynchronous file reads/previews.
   Disable selection/actions during commit; reject double submit. Empty/all-skipped
   files show zero new records and cannot confirm. Preserve selected valid preview
   on persistence failure for retry; report actual committed counts on success.
3. Preserve imported UUID/title/status for new records. Skip every ID present in
   inspections or pending queue (case-insensitive), including pending deletion;
   never resurrect a pending tombstone or overwrite user changes. Preview counts
   are advisory: recheck inside the final transaction for concurrent tabs. Re-import
   and concurrent imports add each ID at most once and never duplicate CREATE queue
   operations. Existing records and queued snapshots remain unchanged.
4. New rows, immutable CREATE queue snapshots and sequence advancement commit in
   one IndexedDB readwrite transaction across existing stores, in file order.
   Any failure rolls back the entire batch. Existing DB version/schema unchanged.
   Validate sequence/capacity before writes; all-skipped batches leave metadata and
   queue unchanged. Capture input before awaits, notify only after a successful
   nonempty commit. Refresh UI from persisted data and trigger existing synchronization
   machinery after success when online; no change to replay/API/Web Lock semantics.
5. Add meaningful fake-IndexedDB/Vitest coverage: exported roundtrip, malformed
   metadata/rows, limits/Unicode/duplicates, preview read-only, skipped/queued-deleted
   IDs, sequence/payload integrity, repeat/concurrent imports, caller mutation,
   sequence exhaustion and constraint failure rollback, no-op preservation.
6. Extend existing isolated Chromium deployed smoke to check invalid-file/Cancel
   read-only, offline valid preview/confirm, conflict skip, actual counts,
   persistence/re-export, repeated import no writes and retained queue snapshots.
   Run autonomously locally and on actual hosted site after deployment through
   Actions. Keep synthetic-only API guards and exact deployment SHA evidence.
   Screenshot the import preview for the visible UI PR evidence. Do not request
   user manual testing for these covered browser scenarios.
7. Document limits, duplicate/queue skip policy, confirmation and offline behavior
   in human README. Export is still inspection-only, not a full queue backup;
   import does not restore queue history/server state or resolve remote conflicts.
   Preserve sync limitations, Pages/PWA boundaries and credential hygiene.
8. Push draft/spec and obtain Agent B own exact-SHA requirements approval before
   code; lifecycle ready/in_progress then real PR, separate in_review registry commit
   with actual PR on same branch. Self-review all criteria, independent exact-final-
   head durable review and green CI before protected merge. Run both npm ci installs,
   lint/builds/type checks/frontend and disposable-PostgreSQL suites/browser checks,
   documentation links/registry/scope/history/whitespace. Persist full hosted run
   and direct smoke results after merge before separately reviewed registry-only
   completion; no invented success or waived gates.

## Allowed and protected scope

Allowed: this spec/additive registry; src/import.ts, src/ImportInspections.tsx,
src/App.tsx, src/db.ts (add atomic import helpers only, existing mutations unchanged),
new tests/import.test.ts; scripts/deployed-smoke.mjs (add import scenarios only);
README.md. Protect all other paths, historical TASK001–014 specs/entries, backend,
workflows, dependencies/lockfiles, runtime/PWA configuration/schema/migrations/assets,
existing tests and root mandatory gates. Generated smoke artifacts stay untracked.
Assumptions: this browser is the local source of truth; restored IDs may conflict
with a separately configured remote backend under existing replay rules. A single
logical writer per inspection remains required for later edits/sync. No paid hosting,
user browser access, production DB or network-policy bypass. No critical ambiguity.
