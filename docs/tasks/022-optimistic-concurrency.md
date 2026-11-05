# TASK-022 — Optimistic concurrency for inspection edits

## Original request / goal

Two inspectors can edit the same inspection on different devices. Prevent the
second, stale title/status edit from overwriting an accepted edit. The server must
atomically check an expected version and return a conflict. Preserve typed and
queued local intent, show the current server value, and require a human to review
and deliberately submit a reconciliation. Never silently rebase version3 onto4.

## Constraints and file scope

Preserve offline-first CRUD, immutable FIFO payload snapshots, at-least-once
replay, atomic IndexedDB transactions, same-origin sync Web Lock, shared30second
activity snapshots, tombstones, runtime-only owner credentials and PWA scope.
IndexedDB remains version2 with its existing stores. No dependency changes,
per-user accounts, production test writes, automatic merges, background polling or
unrelated refactors. DELETE remains the existing explicit unconditional tombstone
action; stale-delete fencing is outside this task and must be documented.

May change focused src db/API/sync/inspection/UI modules, focused tests/browser
fixtures, server app/validation and a new003migration, README/context/deployment
notes, this task and its registry entry. Protect applied001/002 migrations,
package manifests/lockfiles, credentials/env, hosting resources and historical
registry/task records. The isolated branch is codex/022-optimistic-concurrency.

## Proposed protocol and recovery design

Every server inspection has a positive integer version, initialized to1 by
migration003 and incremented by successful PATCH. All inspection reads, snapshots,
CREATE and PATCH acknowledgments include version. PATCH requires expectedVersion
and a stable UUID mutationId in JSON, in addition to at least one title/status
field. Missing versions fail closed; no old-client fallback bypasses the check.

Successful versioned CREATE/PATCH operations persist permanent mutation receipts
in the same PostgreSQL transaction as the write. A receipt binds mutationId,
inspection identity, operation and normalized request content, and retains the
original successful acknowledgment. Identical replay returns that acknowledgment
without touching the current inspection; identity/content reuse is a conflict.
Receipt lookup precedes version checking. CREATE receipts anchor offline successor
versions without using a later current row as their original acknowledgment.
Legacy POST without mutationId retains safe existing identity/content behavior;
DELETE behavior is unchanged. Receipts must survive subsequent edits/deletion.

A queued UPDATE captures an immutable expectation: either the known server
version, or its local CREATE/UPDATE predecessor mutationId. Enqueuing atomically
records its predecessor and local intent. Successful acknowledgment and queue
removal atomically persist the acknowledged version in existing syncMetadata;
replay resolves a predecessor only from that causal acknowledgment, never from
GET/current local state. Once a queue drains, later edits use the latest causal
ACK version (recorded in metadata), without ACKs overwriting local fields. A clean
legacy row may acquire an authoritative source version from a validated normal
snapshot; pending legacy intent never acquires an expectation retroactively.
This supports multiple offline edits and local
CREATE→UPDATE chains while preserving FIFO. Snapshot application never rewrites
pending payloads or their expectations. Existing pending queue entries without a
provable version/predecessor remain explicitly blocked for human review.

A conflict retains the original queue item and local intent, stops FIFO and shows
its title/status and validated current server title/status/version. Unsaved editor
text remains selectable. Explicit review can refresh server data without writing.
A reviewed save creates a fresh mutationId and a new immutable UPDATE against the
version actually shown to the user; it replaces only the blocked queue item at
that FIFO position. Retry alone never changes an expectation. Replacing/discarding
a predecessor does not alias its identity to a fresh acknowledgment: dependent
successors remain retained, block for their own explicit review and cannot
silently undo the reconciled result. Server changes during review produce another
conflict. Existing explicit Discard remains available with clear retained-data
semantics. Recovery drafts and queued title/status must survive reload.

## Acceptance criteria

1. Migration003 adds version and durable receipt storage without rewriting prior
   migrations. Version is returned and validated across list/detail/snapshot,
   CREATE and PATCH. Server input validates safe positive integer versions and
   UUID mutation identities; unknown fields/type/size/auth safety remain intact.
2. PATCH applies only through an atomic UPDATE with identity and expected version
   predicates, increments once, and preserves omitted fields/id/createdAt. Of two
   concurrent requests with the same expected version, at most one succeeds; the
   other returns409 VERSION_CONFLICT with a validated current inspection and
   leaves server content unchanged. Missing rows retain inspection-specific404;
   missing/invalid expectation never performs a write, including legacy clients.
3. Lost acknowledgments and later retries are safe. A matching successful receipt
   replays its original response/version after intervening changes or deletion
   without another update/increment. Reusing a mutationId for another identity,
   operation or normalized content is rejected. Concurrent replay commits one
   mutation/receipt; receipts are never inferred merely from equal current fields.
4. New local writes atomically persist immutable version/causal expectations and
   queue snapshots. Two or more offline UPDATEs, CREATE→UPDATE and cross-tab
   enqueues replay from their own causal acknowledgments. Atomic dequeue+ACK
   persistence survives restart/lost local commit. Pending local values are never
   overwritten by upload ACKs or activity snapshots. No queue compaction occurs.
5. Clean legacy rows may acquire an authoritative version through a validated
   normal snapshot. Pending legacy queue items cannot gain a guessed/current
   expectation automatically. They remain visibly blocked with preserved intent and
   a deliberate server-review path. Current row refresh may supply information
   for review but cannot mutate existing queued expectations or unblock writes.
6. Conflict UI shows queued/recovery title and status alongside current server
   title/status/version. Keep unsaved typed text across conflict, cross-tab refresh
   and remote deletion; keep queued intent/recovery across reload. Explicit
   reconciliation submits exactly the reviewed fields against the shown version
   with a fresh mutationId. A second remote edit conflicts again. Later dependent
   items remain unchanged and require separate review if their predecessor was
   replaced/discarded. Retry/Discard never silently rebase or lose later intent.
7. Deterministic frontend and real-PostgreSQL tests cover stale title/status,
   concurrent winner, lost ACK after intervening edit/deletion, receipt mismatch,
   offline chains, restart/atomic rollback, malformed ACK/receipt and aborted commit
   retention, legacy missing versions, immutable
   queue/pending shields, recovery and deletion regressions. A real browser run
   with two independent storage contexts and disposable API/PostgreSQL proves
   one inspector wins, stale edit cannot overwrite, typed/queued text remains,
   current server value is visible, deliberate retry works, a second race blocks
   again, and offline dependent operations remain safe. Existing CRUD/activity/
   auth/PWA tests remain green; run lint, frontend build, server build, frontend
   tests and server tests with disposable TEST_DATABASE_URL.
8. Exact-SHA Agent B requirements approval and explicit implementation authority
   precede code. Self-review, durable exact-final-head Agent B implementation
   approval and successful configured CI precede merge. Deploy backend/migration
   before frontend; old clients may receive a safe version-required failure until
   updated. Verify backend contract using disposable data locally, record hosted
   release/health and full exact-SHA Pages smoke without production inspection
   writes, then use a separate reviewed registry-only completion reconciliation.

## Assumptions / unresolved questions

Shared owner authorization remains one principal. Versions protect title/status
edits, not explicit DELETE. Receipts and deletion tombstones are permanent for
arbitrarily late offline replay; storage growth remains a private-demo limit.
Normal snapshots remain activity-driven and rate-limited; conflict review is an
explicit user action and must not introduce polling. The precise safe review-read
implementation and UI placement may vary without changing these guarantees.

The orchestrator compared independent interpretations and approved this design.
Implementation remains blocked until Agent B persists exact-SHA requirements
approval and the orchestrator grants explicit implementation authorization. No
review approval is claimed by this specification.
