# TASK-011: Offline inspection export

## Goal and authority

Add a user-triggered JSON download of all locally stored inspections, online or offline.
The user authorizes autonomous feature selection, implementation, review comments,
protected merges after gates and registry completion. No hosting/cost/data deletion.
Start from remote main `06ce2bc0c7b4e407d653c297332b5ed19f55f5b1`.
Branch `codex/011-offline-inspection-export`.
Read [AGENTS](../../AGENTS.md), [registry](registry.json), this spec, routed
[frontend](../agent-context/frontend.md), [workflow](../agent-context/workflow.md),
[validation](../agent-context/validation.md), [lifecycle](README.md) and
[README](../../README.md). Deployment follows [CONVENTIONS](../../CONVENTIONS.md).

## Acceptance criteria

1. A visible accessible `Export inspections` button reads fresh persisted IndexedDB
   inspections with the existing readonly loadInspections transaction, not filtered
   or stale React state. Includes draft/completed and empty datasets. Export never
   writes data, modifies/removes queue items, retries synchronization or fetches HTTP.
2. Download UTF-8 application/json as `fieldops-inspections-<UTC timestamp>.json`.
   Versioned envelope has exactly format `fieldops-inspections`, schemaVersion1,
   exportedAt ISO UTC and inspections containing only id/title/status. Preserve all
   strings and statuses, including Unicode and legacy titles; do not normalize,
   mutate or omit records. Exclude sync queue, metadata, tokens and extra fields.
   This is a portable inspection copy, not a full database backup or restore feature.
3. Pending export disables only its button and exposes polite progress. Rejections
   give a generic accessible error without raw DB/user data; success says download
   requested, never guarantees file saved. Repeat attempts after failure work.
   Object URLs and temporary links are cleaned up on success/failure; delayed URL
   revocation allows browser download dispatch. No synchronous click without a user
   request, no network, no dependency added, no import or schema change.
4. Meaningful existing-Vitest tests cover JSON roundtrip Unicode/empty/all statuses,
   extra-field exclusion, current persisted data across changes, readonly/queue
   preservation and storage failure; download dispatch/cleanup success and failure.
   Extend Vitest include to tests/*.test.ts so export tests run locally and in CI.
5. README explains export includes all statuses regardless filter, local plaintext
   privacy, offline availability, no queue/restore and browser download limitations.
   Existing offlineCRUD/sync/PWA/backend behavior remains unchanged.
6. Push spec/draft first; Agent B independently reviews original requirements and
   authors durable exact-spec-SHA approval before code. Then implementation/self-review,
   real PR, same-branch in_review actual number, Agent B exact-final-head approval and
   successful CI before protected merge. Verify deployment and real-browser export;
   distinguish local vs hosted and reported vs direct evidence. Mark done only via
   separate reviewed registry reconciliation after applicable live checks.

## Scope and validation

Allowed preparation: this spec and additive TASK-011 registry entry.
Allowed implementation: src/App.tsx, new src/export.ts, new tests/export.test.ts,
vitest.config.ts, README.md, this spec and registry. No src/db.ts/schema/queue/api/sync,
backend, dependencies/manifests/lockfiles, workflows, runtime config, migrations,
assets/styles or historical TASK001–010 specs/entries. Preserve unrelated work.
Run lint, frontend/backend typechecks/builds, all frontend and PostgreSQL tests,
registry/schema/lifecycle/history/scope/docs links/whitespace checks and hosted CI.
Use existing throwaway PostgreSQL only. Browser checks: filtered view still exports
all rows; offline click/download; downloaded JSON; delete/status/reload unchanged.
No public API or hosting rollout is implied. Browser and live-site access may be
unavailable in the managed environment; never claim unperformed checks or done.
