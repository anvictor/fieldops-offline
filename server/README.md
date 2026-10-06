# FieldOps API

A separate Node.js/TypeScript Express REST API backed by PostgreSQL. The React PWA can replay its IndexedDB mutation queue through the local Vite proxy. Production supports a private single-owner bearer token. No server-to-client download, per-user accounts or conflict resolution is implemented.

## Local setup

Use Node.js 20.19+ and Docker Compose v2. From the repository root:

```sh
npm ci
npm --prefix server ci
test -e server/.env || cp server/.env.example server/.env
```

Edit `server/.env`: choose a local database password and put its URL-encoded value in `DATABASE_URL`. These are local development credentials only; `.env` is ignored. Keep real credentials out of commits. The API binds to `127.0.0.1:3001` by default; PostgreSQL binds to loopback port 5432. `HOST`, `PORT`, `DATABASE_URL`, and the Compose `POSTGRES_*` variables configure them. Development mode refuses any host other than `127.0.0.1`, `::1` or `localhost`.

```sh
docker compose --env-file server/.env -f server/compose.yaml up -d --wait
npm run server:migrate
npm run server:dev
```

The PostgreSQL named volume persists across container restarts. `docker compose --env-file server/.env -f server/compose.yaml down` stops containers without deleting that volume. Changing environment credentials does not change passwords in an existing volume.

Migrations run explicitly, in filename order, inside a transaction with a migration ledger and advisory lock. Rerunning is safe. Add a new numbered SQL file for future schema changes; do not edit applied migrations. Neither startup nor frontend deployment runs migrations automatically.

## Commands

- `npm run server:dev`: TypeScript development server with restart on changes.
- `npm run server:build`: compile server and type-check integration tests.
- `npm run server:start`: run the compiled server after building.
- `npm run server:migrate`: apply migrations using `DATABASE_URL`.
- `npm run server:test`: run Node's built-in test runner against `TEST_DATABASE_URL`.
- `npm run lint` / `npm run build`: repository lint / existing frontend build.

Root scripts delegate to `server/`, so its `.env` resolves consistently. For a compiled installation retain `server/migrations/` alongside `server/dist/`; the migration runner is also available as `node dist/migrate.js` from `server/`.

## REST contract

All responses are JSON except successful deletion. Inspection objects have UUID `id` (server-generated when omitted on create), trimmed `title` (1–200 Unicode characters, no null character), `status` (`draft` or `completed`), and UTC ISO `createdAt` / `updatedAt` timestamps.

- `GET /api/health`: 200 `{ "status": "ok", "service": "fieldops-api" }`. Process liveness only, not database readiness.
- `GET /api/inspections`: 200 array ordered by creation time then ID.
- `GET /api/inspections/:id`: 200 inspection; 404 if missing.
- `POST /api/inspections`: JSON `{ "title": "Inspect pump", "status": "draft" }`; status defaults to draft. Returns 201 and a `Location` header.
- `PATCH /api/inspections/:id`: at least one of title/status; returns 200. Omitted values, ID, and creation time are preserved.
- `DELETE /api/inspections/:id`: 204 with no body; 404 if missing.

POST also accepts an optional client UUID `id`. A new ID returns 201; replay of the same ID and normalized title/status returns the existing row with 200. Omitted status defaults to draft before comparison. Different content at that ID returns 409 `ID_CONFLICT`; concurrent same-ID requests use PostgreSQL uniqueness safely. PATCH still accepts only title/status.

Missing inspection GET/PATCH/DELETE returns 404 JSON `INSPECTION_NOT_FOUND`; unknown routes retain `NOT_FOUND`. The client treats only a verified inspection-specific missing response as successful repeated DELETE; missing PATCH remains blocked.

Only title/status (and optional create id) are writable. Unknown fields, invalid UUIDs, and invalid values return 400. Writes require `Content-Type: application/json` (415 otherwise); the body limit is 16 KiB (413). Errors use `{ "error": { "code": "INVALID_INPUT", "message": "..." } }`; unexpected errors return a generic 500 without stack traces or database details. SQL values are parameterized.

```sh
curl http://127.0.0.1:3001/api/health
curl -i http://127.0.0.1:3001/api/inspections \
  -H 'Content-Type: application/json' \
  -d '{"title":"Inspect pump"}'
```

## Database tests

Create a separate disposable test database in the local container (adjust the user if configured differently):

```sh
docker compose --env-file server/.env -f server/compose.yaml exec postgres \
  createdb -U fieldops fieldops_test
```

Set `TEST_DATABASE_URL` in `server/.env` to that database, then run `npm run server:test`. Tests fail rather than skip if it is absent. Each run creates and removes a uniquely named schema; never point tests at a production database. Tests cover migration reruns, CRUD, persistence through a fresh app/pool, validation, missing resources, malformed/oversized bodies, SQL-like input, and safe database failure responses. The deliberate database failure emits one generic server error log.

No coverage percentage is configured. Backend `*.test.ts` uses Node's test runner through `tsx`. The frontend has a separate Vitest synchronization suite in `tests/sync.test.ts`, run from the root with `npm test`.

## Deployment boundary

GitHub Pages continues to deploy only the existing PWA. The repository provides local setup and a production API foundation, not an already hosted public API. Hosted PR CI builds both applications and executes frontend synchronization tests plus the real-PostgreSQL backend suite. Unauthenticated mode is for loopback development only. Production owner authentication and CORS are described below; actual hosting, frontend credential UX, per-user authorization, pagination and full operational hardening remain rollout work.


## Production API foundation

`API_MODE=production` is explicit opt-in; `NODE_ENV=production` also defaults to
production and cannot be overridden to unauthenticated development. Startup fails
closed without a valid API_TOKEN and CORS_ORIGINS. Production defaults HOST to
`0.0.0.0`; PORT remains 3001 unless the host supplies another valid port.

This mode is a **private single-owner API**. Anyone holding its owner token has
access to the same inspection data; there is no per-user tenant separation, login,
expiry/session management or initial server download. Do not share it as a public
recruiter demo credential. CORS does not prevent nonbrowser requests and is not
an authorization mechanism.

Inject these as runtime environment/host secret settings, never Docker build args:

- DATABASE_URL: private PostgreSQL URL, with verified TLS when required by host.
- API_TOKEN: a cryptographically random 32-byte (or longer) base64url token,
  43–128 URL-safe characters. Syntax validation cannot prove entropy. Generate it
  in a trusted secret manager or locally and store it securely, never paste it in
  chat/logs. For local shell generation without printing: `API_TOKEN=$(node -e
  'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')`.
- CORS_ORIGINS: comma-separated canonical HTTPS origins, for example
  `https://anvictor.github.io`. No wildcard, credentials, path, trailing slash,
  query or fragment. Do not include `/fieldops-offline/` in an origin.
- NODE_ENV=production, API_MODE=production, HOST=0.0.0.0 and host-provided PORT.

All inspection methods and unknown routes require `Authorization: Bearer <token>`.
Only the exact GET `/api/health` is anonymous; it reports process liveness, not DB
readiness. HEAD is protected too. Failed auth returns generic401 before body
parsing/SQL; denied browser origins return403 even with a valid token. Allowed
origins receive explicit CORS headers, no cookies/credential permission. Preflight
accepts GET/POST/PATCH/DELETE with Authorization/Content-Type only and otherwise
fails closed. No-Origin clients still require auth. Production responses use
no-store and nosniff headers. Existing REST/replay/safe-error semantics remain.

Rotate the token by replacing its runtime secret and restarting instances together;
old tokens immediately fail on updated instances. Do not put it in VITE_* variables,
frontend source, IndexedDB, public files, image layers or URLs. Existing frontend
has no credential-entry flow and cannot synchronize with this protected API yet;
leave its production sync configuration disabled until a separately reviewed UX
exists. Offline CRUD and the Pages/PWA build remain unchanged.

## Container and hosted rollout checklist

Build from the server directory/context:

```sh
docker build -t fieldops-api server
```

BuildKit optionally accepts a public proxy CA with
`--secret id=proxy_ca,src=<CA path>`; only dependency installation mounts it.
Never disable TLS verification. The Node22 multi-stage image runs as non-root,
contains production dependencies, compiled app and migrations, and excludes env
files/local data. No listener starts successfully without production configuration.

The host must supply TLS termination and a private database. Container HTTP is
appropriate only behind that host's HTTPS ingress/private network; publishing its
port directly to the Internet is not a TLS deployment. Express does not trust
forwarded headers or proxy client IPs. Configure external rate limits, quotas,
backup/restore, log redaction and capacity before exposure. Collection reads are
currently unpaginated; limit this private demo's dataset and concurrency. The token
is the data-access boundary, not a complete public multi-user service.

Provider-neutral commands:

- Build: `docker build -t fieldops-api server`.
- Release/migration: with the same runtime DATABASE_URL, run a one-off image command
  `node dist/migrate.js` **before** starting the new app. No automatic migration.
- Start: image default `node dist/index.js` with runtime secrets and host PORT.
- Health: GET `/api/health`; separately verify authenticated DB CRUD/replay.

Before claiming rollout complete: obtain connected hosting authorization (and
approve any cost), choose private persistent PostgreSQL with backup/TLS policy,
configure secrets/origin and HTTPS ingress, apply release migrations, smoke unauth
401 and forbidden-Origin403 plus authenticated create/read/update/delete and replay,
check secret-free logs, then enable a reviewed client credential UX. Do not remove
existing DB volumes or run tests against production. Keep TEST_DATABASE_URL disposable.

Rollback: retain the previous image and runtime config, stop accepting new traffic
when needed, revert app image/config after checking schema compatibility. Applied
migrations are not rewritten/reversed automatically. This task adds no migration.
Record deployed SHA, run/status and direct vs reported live evidence in GitHub.

For a local smoke test, publish container ports only on loopback and use an isolated
throwaway database. Use a runtime `--env-file` outside the build context with restrictive
permissions; never commit it or dump container environment/inspect output containing
secrets. Stop and remove only those disposable containers afterward.
