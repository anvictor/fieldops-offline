# Task 004: Installable PWA with Offline App-Shell Caching

## Goal

Make FieldOps Offline installable and able to reload its production React shell without a network after an initial successful visit and completed service-worker installation.

## Scope and constraints

Use Vite PWA integration with Workbox-generated service-worker registration and precaching. Preserve `/fieldops-offline/`. Allowed files: package.json/package-lock.json, vite.config.ts, public PWA icons, this specification, and task registry; index.html only if required for PWA metadata.

Do not change IndexedDB schema/version, CRUD/filtering, queue semantics, shared connectivity Context, reconnect logging, styling or application UI beyond PWA metadata. No server synchronization. Preserve AGENTS.md local edits, all HTML documents, and .codex/config.toml; never include local configuration in commits. Deployment workflow remains unchanged because it publishes the entire dist directory.

## Acceptance criteria

1. Generated manifest provides name, short_name, Pages-compatible start_url and scope, standalone display, theme/background colors, and valid 192/512 PNG icons.
2. Production build generates and registers a Workbox service worker through Vite PWA.
3. Required HTML, JavaScript, CSS and static startup assets are precached under the Pages base path.
4. After an online production visit completes precaching, offline reload renders FieldOps. Verify the production preview before merge; repeat on the deployed app after authorized merge/deployment. Do not claim deployed verification from preview evidence.
5. Existing IndexedDB inspection persistence survives reload, including offline reload.
6. Online/offline Context behavior remains intact.
7. Reconnect pending-queue logging remains unchanged.
8. No server synchronization or new queue behavior is introduced.
9. npm run lint and npm run build (including TypeScript) pass.
10. TASK-004 follows the existing task lifecycle: initial in_progress with branch codex/004-offline-pwa and null PR, then in_review with its actual implementation PR. Previous entries remain unchanged; no premature done.
11. Feature branch and PR target main; do not merge.

## Design assumptions

Use generateSW and injected registration without modifying React code. Updates wait for existing tabs to close, avoiding forced reloads and unsaved form loss; no custom update UI is introduced. Initial offline readiness requires installation and caching to finish, not merely the first HTTP response. HTTPS (or localhost for validation) and browser service-worker support are required. Cached storage can be evicted or cleared; first-ever offline visits cannot work. Browser installation UX varies. No runtime API caching is configured.

## Validation and review

Follow AGENTS.md independent requirements review, implementer self-review, independent code review and merge gates. Inspect built manifest, icon dimensions, registration scope and Workbox precache. In a fresh browser profile serve production output at the real base path, complete installation, then disable network and reload; check actual service-worker responses rather than relying on browser HTTP cache. Verify UI, offline CRUD/filtering and persistence, online/offline transitions and reconnect logging. Run lint/build and registry checks. Preserve unrelated file hashes and stage only scoped files.

## Completion limitation

The current request permits a PR, not deployment or merge. Deployed offline reload remains a post-merge verification requirement. Record evidence and limitations accurately in the PR; later completion requires applicable live verification and separate registry reconciliation.
