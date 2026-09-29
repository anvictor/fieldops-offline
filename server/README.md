# FieldOps API

A separate Node.js/TypeScript Express REST API backed by PostgreSQL. The React PWA does not call it. No IndexedDB synchronization, authentication, or conflict resolution is implemented.

## Local setup

Use Node.js 20.19+ and Docker Compose v2. From the repository root:

```sh
npm ci
npm --prefix server ci
cp server/.env.example server/.env
```

Edit `server/.env`: choose a local database password and put its URL-encoded value in `DATABASE_URL`. These are local development credentials only; `.env` is ignored. Keep real credentials out of commits. The API binds to `127.0.0.1:3001` by default; PostgreSQL binds to loopback port 5432. `HOST`, `PORT`, `DATABASE_URL`, and the Compose `POSTGRES_*` variables configure them.

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

All responses are JSON except successful deletion. Inspection objects have server-generated UUID `id`, trimmed `title` (1–200 Unicode characters, no null character), `status` (`draft` or `completed`), and UTC ISO `createdAt` / `updatedAt` timestamps.

- `GET /api/health`: 200 `{ "status": "ok", "service": "fieldops-api" }`. Process liveness only, not database readiness.
- `GET /api/inspections`: 200 array ordered by creation time then ID.
- `GET /api/inspections/:id`: 200 inspection; 404 if missing.
- `POST /api/inspections`: JSON `{ "title": "Inspect pump", "status": "draft" }`; status defaults to draft. Returns 201 and a `Location` header.
- `PATCH /api/inspections/:id`: at least one of title/status; returns 200. Omitted values, ID, and creation time are preserved.
- `DELETE /api/inspections/:id`: 204 with no body; 404 if missing.

Only title/status are writable. Unknown fields, invalid UUIDs, and invalid values return 400. Writes require `Content-Type: application/json` (415 otherwise); the body limit is 16 KiB (413). Errors use `{ "error": { "code": "INVALID_INPUT", "message": "..." } }`; unexpected errors return a generic 500 without stack traces or database details. SQL values are parameterized.

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

No coverage percentage is configured. `*.test.ts` uses Node's test runner through `tsx`; no frontend test framework is added.

## Deployment boundary

GitHub Pages continues to deploy only the existing PWA. This task provides local API/database setup, not public backend hosting. Hosted frontend CI does not execute the database tests or backend build; run the backend gates explicitly before review. This unauthenticated API is for local development; public hosting, authorization, CORS policy, pagination, and operational hardening belong to later tasks.
