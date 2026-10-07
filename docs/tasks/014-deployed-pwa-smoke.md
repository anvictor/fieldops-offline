# TASK-014: Automated deployed PWA smoke verification

## Goal and authority

Automate real-browser checks after Pages deployment so routine completion does not
require the user to manually verify each release. User authorizes autonomous task
choice, workflows/dependencies/code/checks/comments/merges after all gates, with
sensible model/token use. No paid service or important-data deletion.
Base main `df5e0e48fe3686160793bdbc29604b455950da2f`.
Branch `codex/014-deployed-pwa-smoke`.
Startup [AGENTS](../../AGENTS.md) → [registry](registry.json) → this spec →
[workflow](../agent-context/workflow.md), [frontend](../agent-context/frontend.md),
[validation](../agent-context/validation.md), [lifecycle](README.md), human
[README](../../README.md), [CONVENTIONS](../../CONVENTIONS.md). Do not preload history.

## Design and acceptance criteria

1. Add exact pinned dev-only playwright@1.63.0 with updated root lockfile and
   test:live script. Add focused Node .mjs smoke/config/build-info scripts. Public
   Ubuntu GitHub Actions runners perform browser checks; no paid hosting/provisioning,
   credentials, cookie login, production DB or network-policy bypass is involved.
2. Build adds generated dist/build-info.json (not tracked/public source or PWA
   precache) containing schemaVersion1 and full deployment commit SHA. Validate SHA
   before writing. Browser smoke requires expected SHA and retries boundedly until
   an uncached public marker equals it; old/cached deployments cannot pass. Version
   marker contains no env variables, credentials or paths. App/PWA scope unchanged.
3. Smoke targets only exact https://anvictor.github.io/fieldops-offline/ or loopback
   http://127.0.0.1|localhost:<port>/fieldops-offline/ for local/PR checks; reject
   credentials/query/fragment/other hosts/paths. Fresh isolated browser context and
   synthetic inspections only. Explicit page-fetch API guard and network routing
   block /api and cross-origin backend requests before CRUD, including future
   configured API bases. Never send synthetic mutations to a real backend, delete
   user data, read user credentials or assert end-to-end API synchronization.
4. Real browser checks anonymous deployed shell, local create/status/reload,
   title edit/save/reload and Cancel/no-op, search AND status/Clear/no-match,
   versioned export-all, cached offline reopen/CRUD/export. Assert expected records
   and retained status/ID; snapshot local inspection/queue state to catch unintended
   export/search mutation. Failed uncached fetch establishes emulated offline
   transport; do not infer navigator.onLine correctness from tool emulation.
   Browser errors exit nonzero; generic safe progress/results, bounded timeouts.
5. CI PR validate job runs same smoke against freshly built loopback production
   preview, expected GITHUB_SHA marker, and shuts preview down with trap. Pages
   workflow exposes deployment page_url, then separate smoke job needs deploy,
   checkout exact github.sha, installs pinned browser, verifies actual public URL
   and expected SHA. Job permissions contents:read only, no secrets or write token.
   Existing build/deploy environments/permissions/scopes preserved. Overall workflow
   fails if smoke fails; completion checks full workflow, not deploy job alone.
6. Upload compact synthetic-only report/screenshot artifacts on success/failure
   with short retention; no full environment/log/header/trace dumps. Report states
   target/version/checks, direct automated hosted vs loopback evidence and API
   isolation limitations. Meaningful existing-Vitest config tests cover allowed and
   forbidden targets, invalid SHA and mismatched/malformed version marker. Lint new
   scripts; no application code/backend/schema/assets/migrations/sync changes.
7. README and agent validation context document local vs hosted commands/evidence,
   generated marker, isolated data/API boundaries and expanded gate. These checks
   are direct automated hosted live evidence; future changed behavior still needs
   relevant checks, never an automatic waiver of manual testing or root gates.
8. Push spec/draft and own Agent B durable requirements approval before code. All
   local gates (both lockfiles npmci, lint/builds/frontend/backend tests+disposable
   PostgreSQL, smoke, docslinks/registry/history/scope/whitespace), final-head CI and
   exact-head Agent B durable approval before protected merge. Verify post-merge
   full Pages workflow including actual deployed smoke, persist evidence, then
   separate reviewed registry-only reconciliation. Never predict live success/done.

## Allowed/protected scope and assumptions

Allowed: this spec/additive registry; root package.json/package-lock.json;
scripts/smoke-config.mjs, scripts/write-build-info.mjs, scripts/deployed-smoke.mjs;
new tests/smoke.test.ts; eslint.config.js; .github/workflows/ci.yml and deploy.yml;
README.md and docs/agent-context/validation.md. Generated smoke-results and dist
outputs stay untracked (ignore smoke-results in .gitignore). No other files,
TASK001–013 specs/entries, src/application code, backend/dependencies/lockfiles,
DB/API/queue/schema/migrations, tracked assets/PWA manifests/configuration changes.
Assume public repository standard GitHub runners remain free; no larger runners.
Local system Chromium may be selected via explicit SMOKE_BROWSER_EXECUTABLE for
local validation; GitHub uses the pinned Playwright browser. Managed environment
cannot reach Pages directly; GitHub runner performs authorized live checks rather
than changing or bypassing managed proxy policy. Screenshots are synthetic fixtures.
