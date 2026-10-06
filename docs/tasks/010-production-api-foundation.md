# TASK-010: Production API foundation

## Goal and bounded increment

Prepare the existing Express/PostgreSQL API for a controlled single-owner hosted
rollout without exposing the current unauthenticated development API. This is the
first implementation increment toward the user-authorized safe public backend.
Actual hosting account provisioning, a public URL and frontend credential UX are
subsequent rollout work: no hosting account/identity is connected in this task.
Do not claim public deployment or multi-user authentication from this foundation.
The user's standing authorization covers implementation, comments, reviews,
PR merges after gates, deployment verification and registry completion; costs
or deletion of important data still require explicit approval.

## Startup and authority

Follow [AGENTS.md](../../AGENTS.md) → [registry](registry.json) → this spec →
[backend](../agent-context/backend.md), [workflow](../agent-context/workflow.md),
[validation](../agent-context/validation.md), [registry conventions](README.md)
and relevant [server setup](../../server/README.md). Load frontend context only
for client/contract impact assessment; never recursively preload history.
Base is remote main `0aadfc2655e516d2b18e84fa130008b1b1b11fcb`.
Branch: `codex/010-production-api-foundation`.

## Approved design and acceptance criteria

1. **Fail-closed configuration.** Introduce `API_MODE=development|production`.
   Default development unless NODE_ENV=production, which requires production
   mode and rejects an explicit development override. Development HOST is only
   127.0.0.1, ::1 or localhost; reject wildcard/other addresses. Production can
   bind 0.0.0.0 and requires a valid owner token and explicit origin allowlist.
   Validate PORT as today. Validate all production configuration before opening
   listener/pool; startup errors remain generic and do not expose secrets.
2. **One owner principal.** Production inspection API access (all methods and
   inspection routes, including collection reads) requires exact `Authorization:
   Bearer <token>`. API_TOKEN is a randomly generated 32-byte-or-longer base64url
   secret (syntax length43–128); hashing plus timing-safe comparison verifies it.
   Missing/malformed/wrong credentials receive generic401 with bearer challenge
   before parsing request bodies or any SQL. Health is the only anonymous GET
   application endpoint and exposes existing minimal process-liveness JSON.
   Unknown production routes are also guarded. This is a private owner API, not
   per-user isolation/login/revocation/session management. Never expose the token
   in URLs, logs, committed env files, Docker layers, VITE variables or bundles.
3. **Explicit CORS.** Production CORS_ORIGINS is a nonempty comma-separated list
   of canonical HTTPS origins (no wildcard, null, userinfo, path, query, fragment,
   or trailing slash). For requests with Origin, exact matching is required;
   forbidden origins receive403 without access to SQL. No-Origin nonbrowser
   requests still require bearer auth. Allowed responses echo only the matched
   origin and Vary: Origin; no cookies/Access-Control-Allow-Credentials. Validate
   preflight methods/headers (GET,POST,PATCH,DELETE; Authorization,Content-Type),
   reject malformed/unapproved requests, and allow approved unauthenticated
   preflight with204. CORS is browser policy, never an authentication substitute.
4. **Response safety.** Production responses set Cache-Control:no-store and
   X-Content-Type-Options:nosniff, including auth/error responses. Preserve JSON
   validation limits, parameterized SQL, safe errors, UUID replay/acknowledgment
   semantics and existing health contract. Development behavior remains unchanged
   except unsafe listener configurations now refuse startup.
5. **Deployable container.** Add server Dockerfile and focused .dockerignore.
   Use supported Node22, multi-stage TypeScript build, production-only runtime
   dependencies, non-root runtime, explicit production mode and migrations kept
   beside dist. Never COPY env files or credentials. Database credentials/token
   injected at runtime only. Migrations remain an explicit separate release step,
   not automatic server startup. Build with normal TLS verification and optional
   build-secret CA support for the managed proxy. Test real built container startup,
   liveness, authenticated CRUD, failed auth and migration rerun against disposable
   PostgreSQL with loopback-published ports only. Container is not a public endpoint.
6. **Meaningful tests.** Add configuration and HTTP security tests to existing
   backend Node runner. Cover dev wildcard rejection, production missing/invalid
   token/origins/mode, accepted valid config, all protected methods, body-before-auth,
   exact origin/no-Origin behavior, preflight method/header rejection, generic401,
   minimal anonymous health, safe headers and authenticated real PostgreSQL CRUD.
   Retain and run original API tests plus frontend sync suite. No new dependency
   or framework is needed. Do not alter migrations or offline state.
7. **Honest deployment guidance.** Update focused docs with production env,
   runtime-only token generation/rotation, HTTPS termination/network private DB,
   no unsafe proxy trust, external rate limits/quotas/backups and list-pagination
   limits before Internet exposure. CORS and a shared token are not a complete
   public multi-user service. Provide provider-neutral build/release/start commands,
   validation and rollback checklist. Keep dev setup usable and Pages/PWA separate.
   Existing frontend sends no bearer token; do not enable production synchronization
   or embed credentials. Hosted provisioning/frontend auth are explicit prerequisites
   before claiming end-to-end public synchronization. No paid resource creation.
8. **Workflow and completion.** Push spec/draft and obtain Agent B-authored durable
   requirements review before code. Standing user authorization permits approved
   implementation. Publish PR, record actual PR/in_review after it exists, self-review,
   independent exact-final-head review and all local/hosted gates before protected
   merge. Verify built container and resulting Pages deployment; record direct vs
   reported evidence. Registry done is only a separate reviewed reconciliation after
   this foundation's gates, never a claim that hosting rollout is complete.

## Allowed/protected files

Preparation: this spec and additive TASK-010 registry entry only.
Implementation: server/src/{config,index,app,security}.ts, focused new backend
security/config test files and additions to server/tests/api.test.ts, server/Dockerfile,
server/.dockerignore, server/.env.example, server/README.md, root README.md,
docs/agent-context/backend.md and validation.md, this spec and registry.
No frontend/source/test/PWA/assets/Pages or CI workflow changes, dependencies,
package manifests/lockfiles, existing migrations, compose/development data changes,
historical TASK-001–009 specs or registry entries. Preserve unrelated local work.
Root AGENTS gates and existing task conventions remain unchanged.

## Validation and limitations

Run npm ci for both lockfiles; lint, frontend build/type checks, backend build/type
checks, frontend tests and all PostgreSQL backend tests. Check docs links, registry
schema/IDs/lifecycle/references, historical equality, scope, whitespace and secrets
handling. Build and smoke the production container with throwaway runtime credentials
and isolated DB, no secret output. Hosted CI must succeed for final PR head.
No hosting authorization, cost decision or public-domain/TLS configuration is implied;
report these future rollout requirements separately. Existing live PWA runtime remains
unchanged. No initial download, multi-device resolution or server fencing added.
