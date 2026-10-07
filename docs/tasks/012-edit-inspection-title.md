# TASK-012: Edit inspection titles offline

## Goal and authority

Let users correct existing inspection titles without deleting/recreating records.
User standing authorization permits autonomous feature choice, implementation,
comments, merges after gates and registry completion. No costs or data deletion.
Base remote main `37f830a114dbc2ef7cc14578ec604fc38103fb31`.
Branch `codex/012-edit-inspection-title`.
Startup [AGENTS](../../AGENTS.md) → [registry](registry.json) → this spec → routed
[frontend](../agent-context/frontend.md), [workflow](../agent-context/workflow.md),
[validation](../agent-context/validation.md), [lifecycle](README.md) and human
[README](../../README.md). Deployment uses [CONVENTIONS](../../CONVENTIONS.md).

## Acceptance criteria

1. Each inspection offers Edit title. Accessible labeled input starts with its raw
   title. Save and Cancel are explicit; Enter saves through form submission. Cancel
   preserves original record/queue. No mutation on opening editor or typing.
2. Save uses existing normalizeTitle: trim, 1–200 Unicode characters, no null.
   Invalid input cannot save and exposes helpful validation. An unchanged normalized
   title is a no-op: no queue write or sync retry. Unicode and completed/draft work.
3. Persist through existing saveInspectionWithSync(updated, UPDATE), atomically with
   queued immutable snapshot; do not modify DB/schema/queue implementation. Read the
   current stored record before rename to preserve its ID/status, not a stale card
   status. Missing/deleted record fails safely without resurrecting it. Current
   one-logical-writer assumption remains; no new cross-tab conflict guarantee.
4. UI reflects successful persisted title only after save resolves; reload retains
   title/status/ID. Saving disables that card's editing/status/delete controls;
   failed storage gives generic accessible error, preserves input for retry, and
   never falsely closes editor/reports success. Cancellation remains possible after
   failure. Existing CRUD/filter/export/PWA and sync triggers stay usable. Retry
   sync only after an actual successful changed title, using existing online rule.
5. Meaningful Vitest/fake IndexedDB tests cover Unicode/validation/unchanged no-op,
   preserved persisted status/ID, exact UPDATE queue snapshot/order, later edits not
   altering earlier snapshots, no writes on invalid/missing/failure. Real Chromium
   production-PWA browser verifies edit/save/reload, cancel, validation/error retry,
   offline rename and export reflecting new title. Show actual screenshot in chat
   and reference it honestly in PR if GitHub attachment upload unavailable.
6. README explains edit/save/cancel, normalization, offline persistence and existing
   sync limits. No restore, hosting rollout, backend or concurrency redesign.
7. Push draft spec first, durable Agent B requirements approval before code; genuine
   self-review and independent final-head review/CI before protected merge. Real PR
   then samebranch in_review actualnumber. Successful resulting deployment plus fresh
   hosted live evidence before a separate reviewed done registry reconciliation.

## Scope and gates

Allowed: this spec, additive TASK-012 registry entry, src/App.tsx, new
src/inspections.ts, new tests/inspections.test.ts, README.md only.
Protected: all other files, historical TASK001–011 specs/entries, src/db.ts/api.ts/
sync.ts/export.ts and schema, backend, styles/assets, PWA/runtime configuration,
workflows, dependencies/manifests/lockfiles. Preserve unrelated local work.
Run existing lint, frontend/backend builds/typechecks, all frontend tests and
PostgreSQL integration tests using disposable DB only. Docs links, registry/schema/
IDs/lifecycle/history/scope/whitespace; final-head hosted CI. Do not invent browser,
review or live results. Public Pages access may require user-reported evidence.
