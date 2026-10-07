# TASK-013: Search inspections offline

## Goal and authority

Find inspections quickly by title while preserving existing status filter and offline
CRUD/edit/export. User authorizes autonomous next-feature choice, implementation,
comments and merges after gates; do not wait for another «давай далі». No cost/deletion.
Base remote main `3ad58ff8300a32dafd76ff965e362672d5a5cca9`.
Branch `codex/013-search-inspections`.
Startup [AGENTS](../../AGENTS.md) → [registry](registry.json) → this specification →
[frontend](../agent-context/frontend.md), [workflow](../agent-context/workflow.md),
[validation](../agent-context/validation.md), [lifecycle](README.md), human
[README](../../README.md). Deployment follows [CONVENTIONS](../../CONVENTIONS.md).
TASK-012 is merged but awaits resulting hosted live evidence/reconciliation; do not
falsely mark it done, alter its references or restart it.

## Acceptance criteria

1. A labeled Search inspections input filters visible cards by case-insensitive
   title substring (Unicode String.toLowerCase), trimming query edges. Empty/whitespace
   query shows all titles permitted by selected status. Search combines with All,
   Draft and Completed without changing persisted records, order or global counts.
   No regexp interpretation, diacritic folding, server search or HTTP requests.
2. Clear search resets only query. Show a helpful polite no-match message when
   existing inspections match neither current query nor status. Query is in-memory
   UI state only, not a persisted preference; no schema or queue changes.
3. Existing add/edit/status/delete update the filtered view after persistence.
   Renaming can remove a card from current results without corrupting its queued
   UPDATE; changing filter shows it again. Export still includes every persisted
   record regardless of search/status. Offline behavior and PWA scope unchanged.
4. Meaningful Vitest cases for case-insensitive Unicode substring, trimmed/blank,
   punctuation treated literally, status AND search, stable source/order/no mutation,
   empty/missing matches. Real local Chromium tests search/filter/clear/no-match,
   edit moving record out of results then finding it, export all, cached offline
   search; include screenshot in chat with honest PR reference if upload unavailable.
5. README documents title search/clear/status combination, Unicode and no diacritic
   folding, transient query and export-all semantics. No unrelated feature redesign.
6. Draft/spec push and own Agent B durable requirements approval before code; self-
   review, real PR then samebranch actual in_review; durable exact-final-head review
   and successful CI before protected merge. Resulting Pages deployment and fresh
   hosted live evidence before separate reviewed done reconciliation. Local direct
   vs hosted user-reported evidence remain explicit; no invented checks.

## Scope and gates

Allowed: this specification, additive TASK-013 registry entry, src/App.tsx, new
src/search.ts, new tests/search.test.ts, README.md only. Protect all other files,
TASK001–012 specs/entries (including TASK012in_review), DB/API/sync/export/rename
implementation, backend, assets/styles/PWA/runtime config/workflows, dependencies,
manifests/lockfiles and migrations. Existing one-writer sync limits unchanged.
Run existing lint, frontend/backend builds/typechecks, frontend and disposable
PostgreSQL tests, docslinks/registry/schema/history/scope/whitespace; exactheadCI.
No unperformed live or screenshot claims. Await only actual external blockers,
not general reauthorization for agreed development.
