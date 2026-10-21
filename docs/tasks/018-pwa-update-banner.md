# TASK-018 — Safe PWA update checks and banner

## Authorization and scope

The user requests adding update checks and a banner to the existing app after discussing idle tabs and unsaved inspection forms. This authorizes scoped implementation and validation; requirements and implementation reviews remain mandatory. Do not merge until exact-head gates pass.

## Goal and acceptance criteria

1. Production registers the service worker exactly once through an application-owned controller, preserving generated Workbox caching and `/fieldops-offline/` base/scope. Development and unsupported browsers remain usable.
2. Check for updates at registration, every five minutes while visible/online, and on focus, visible resume and online. Deduplicate checks and throttle resume triggers to one check per minute; handle update errors without unhandled rejection or interfering with CRUD. No offline polling requests. Timer/listeners are cleaned up.
3. Detect an already waiting worker and newly installed updates. Do not show an update banner for the first installation. Show an accessible English banner with Update now, Later and a way to reopen a dismissed update. No focus theft or input reset.
4. Detection never reloads. Only explicit Update now may activate a waiting worker and reload this tab after controller change. Other tabs never reload automatically, even when their controller changes. Explain that owner credentials must be re-entered after reload. Later preserves editing and queue state.
5. Block activation/reload while this tab has unsaved create/rename/token input, an import preview/read/save, pending local mutations/export, or active synchronization. No secret persistence or draft persistence is added. Explain how to finish/cancel work. Check safety again immediately before activation and before reload; if state becomes unsafe, defer reload and let user explicitly retry once safe.
6. Activation errors/timeouts show safe recoverable feedback; no endless disabled update action. An already activated update must still be reloadable on explicit consent. Existing forms in other tabs remain unchanged; no cross-tab forced reload helper.
7. Preserve offline CRUD, pending queue and local records through chosen update/reload. No server/API/IndexedDB schema or queue algorithm changes. Existing caches retain intended cleanup and PWA behavior.
8. Add focused deterministic lifecycle/scheduling/safety tests and a real-browser two-production-version update test proving idle detection, waiting banner, Later, dirty and busy guards, consented reload, persistence/queue and another dirty tab surviving activation. Run lint, frontend/backend type/build and tests, current browser smoke where feasible. Record unavailable prerequisites honestly.

## Allowed files

New frontend update controller, safety helpers, hooks and banner; App/main/form integration and styles; vite.config.ts; focused tests/browser script and package script if required; README and frontend context for changed behavior; this specification and registry. No new runtime dependency is needed.

## Protected files

Server code/tests/migrations/configuration, db.ts persistence/queue algorithm, sync.ts delivery algorithm, secrets, historical task records, deployment base/scope and unrelated files. Do not modify CI unless necessary and re-reviewed.

## Assumptions and design

Use native service-worker registration/events and waiting-worker SKIP_WAITING message, avoiding helper code that auto-reloads all tabs. Generated worker retains prompt behavior. A tab-local consent flag controls reload. Unsaved and pending-work guards are explicitly integrated with current forms and local workflows. This does not guarantee seamless asset access in indefinitely open old versions; it guarantees no involuntary tab reload or draft loss from our update handler.

## Questions

No user-critical ambiguity remains. Reviewer must assess worker lifecycle races, multiple tabs, stale callbacks and realistic browser proof before approval. Deployment/live evidence remains required before done.
