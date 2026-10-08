# TASK-016 — Render and Neon deployment with authenticated PWA synchronization

## Goal and authorization
Deploy FieldOps to Render My Workspace (tea-d4rfaaq4d50c73euibc0), with PostgreSQL in Neon, and directly verify PWA → protected API → PostgreSQL synchronization. The user's 2026-10-08 instruction authorizes implementation, all review/validation gates, and deployment. Never create paid resources without separate consent.

## Architecture and scope
Retain the existing single-owner bearer-token API and pg driver. Deploy a free Render Node API in Frankfurt and a Render static PWA preserving /fieldops-offline/. Existing Pages deployment remains available and its scope unchanged. Use the user's selected Neon project only after confirming a free plan or obtaining consent; create an isolated FieldOps branch/database when necessary, without modifying unrelated data. No Render Postgres, Redis, workers, Neon Auth or per-user login are required.

## Acceptance criteria
1. Production PWA has an accessible password-field owner-token form with explicit Connect and Disconnect. Explain that connecting sends pending local operations to the configured API and that this is private single-owner access. Only a configured HTTPS API may receive the credential; no arbitrary credential target or redirect is allowed.
2. Keep token exclusively in memory for this tab. Clear input after connect and clear credentials on disconnect/reload. Never write it to IndexedDB, localStorage, sessionStorage, URL, export, logs, build variables/assets, screenshots or browser traces. Never share token between tabs.
3. Without a token, production makes no inspection API requests and continues offline CRUD. Connect resumes FIFO synchronization; 401/403 retain operations and give safe reconnect/permission guidance. Authentication failures must not offer Discard as their recovery action.
4. Disconnect/replacement aborts the current run before new sends. Recheck credential availability for every operation/retry; never remove an item after an aborted request. Preserve the Web Lock until aborted work settles. Explain the existing unavoidable possibility that an already received request has reached the server.
5. Preserve atomic queued snapshots, ordering, idempotent CREATE, verified repeated DELETE, retry/error handling and existing offline import/export/search/edit behavior. No IndexedDB schema or applied SQL migration changes.
6. API uses NODE_ENV/API_MODE=production, HOST=0.0.0.0, host PORT, strong generated runtime API_TOKEN, explicit HTTPS CORS origins, verified TLS Neon pooled runtime URL and direct migration URL. No secrets in Git/builds. Keep unauthenticated dev loopback-only.
7. Configure bounded private-demo operation, rate limiting before database work, existing request body/connection limits, and document dataset/quota/backup/restore policy and free-host cold starts. Do not present this as a hardened multi-user service.
8. Run explicit versioned migrations via the direct connection before listener startup, including safe reruns. Free Render lacks paid pre-deploy support: use a reviewed release/start command executing migration before exec of the API, never migrations in the build.
9. Free Render static hosting nests dist under /fieldops-offline/ and provides root redirect/fallback via configuration if available; all assets/manifest/worker remain in existing scope. Include exact SHA build marker. Configure production public API base without secrets. Preserve Pages offline behavior unless its public base is intentionally configured.
10. Verify exact deployed SHA, HTTPS health, anonymous 401, forbidden-origin 403, authenticated CRUD and CREATE replay; use unique synthetic IDs and clean up only synthetic records. Directly verify browser input→queue→API→Neon row, update/delete, offline queued changes and reconnect, reload loses token but retains local data/queue, and separate tabs do not share tokens.
11. Record secret-free live evidence and limitations in the implementation PR. Never claim deployment or full sync complete from build/health alone.

## Validation and review gates
Run npm run lint, npm run build, npm run server:build, npm test, and npm run server:test against only disposable PostgreSQL. Add meaningful auth lifecycle/transport and browser integration tests. Run existing production browser smoke, targeted authenticated browser tests, configuration validation and scope/diff review. CI must succeed for the exact final head.
Agent B first independently interprets the user request, then personally posts requirements verdict for the pushed specification SHA in the designated requirements-review PR Conversation before implementation. Agent B posts implementation verdict for the exact final head in that PR before merge; any head change invalidates approval. Merge only with required green CI, all criteria and reviews. Postmerge Pages/Render/live checks follow. Mark done only in a separately reviewed registry-only reconciliation after successful deployment/live evidence.

## Allowed and protected files
May change focused src/api.ts, src/sync.ts, src/App.tsx and a small credential component/module; auth tests; server production safeguards/release configuration and tests; deployment scripts/render.yaml/CI and relevant documentation; this spec and one new registry entry.
Must preserve src/db.ts/schema/queue payload semantics, applied server/migrations, existing PWA scope/worker update behavior, historical registry/specs, ignored server/.env and unrelated files/features.

## Assumptions and unresolved prerequisites
Current main ad65fc0546c97e0e9ae3f5fc3de745f7dd3a9d80 matches local; current registry 001–015 are done, no open PR or matching task-016 branch exists. Authentication remains one private owner token, not user accounts.
Neon project ID and free-plan confirmation are pending; this blocks infrastructure mutation and production DB configuration, not generic reviewed client/config work. Credentials must come through secure tool/runtime settings; never ask the user to paste secrets in chat.
Existing GitHub CLI authentication fails; use the connected anvictor GitHub tools for commits/PR/review evidence. If external authorization/access prevents any required gate, stop that dependent action and report the exact blocker.
