# Backend and database context

Required for API, database, migrations or backend setup. Read
[server/README.md](../../server/README.md) for actual setup, commands, REST contract
or database-test preparation. Read [validation](validation.md) when testing.
Client/sync contract work also loads the root frontend route.

## Structure and safety

The separate Express/TypeScript application lives in `server/src/`; integration
tests in `server/tests/`, SQL migrations in `server/migrations/`, and local
PostgreSQL Compose setup in `server/compose.yaml`. Node.js 20.19+ is required.
Root `server:*` scripts delegate to server so its `.env` resolves consistently.

Preserve existing ignored `server/.env`; copy the example only when absent.
Never commit or print real credentials. URL-encode local database passwords.
The unauthenticated development API must remain on loopback (`127.0.0.1:3001`
by default); PostgreSQL Compose also binds loopback. Production mode adds private owner-token authorization and explicit HTTPS-origin
CORS; public hosting, frontend credential UX, per-user isolation, pagination and
full operational hardening remain separate rollout work.
Pages deploys only the PWA and does not run server startup or migrations.

Migrations execute explicitly in filename order, transactionally with a ledger
and advisory lock. Add new numbered migrations when authorized; never rewrite
applied ones. Preserve persistent volumes and configuration. Changing environment
credentials does not change passwords in an existing volume. Compiled installs
need migrations retained alongside server output.

## REST and sync limits

Inspection writes accept title/status and optional CREATE UUID only. Titles are
trimmed 1–200 Unicode characters without null; status is draft/completed. Partial
updates preserve omitted fields, ID and createdAt. SQL values are parameterized.
JSON writes enforce type/size validation; safe errors omit stack/DB details.
Health reports process liveness, not database readiness.

CREATE supports client UUID replay: new 201, matching normalized title/status
200, different content 409 `ID_CONFLICT`; concurrent replay uses DB uniqueness.
Missing inspection GET/PATCH/DELETE returns JSON `INSPECTION_NOT_FOUND`, distinct
from unknown-route `NOT_FOUND`. Client DELETE may confirm missing; PATCH blocks.
No per-user accounts, initial download, multi-device conflict resolution or
server-side fencing exists. Preserve these boundaries; do not imply exactly-once
sync or deployed public API. Disposable `TEST_DATABASE_URL` is mandatory for
integration tests; unique schemas do not make a production database safe to use.


## Production foundation constraints

Load server/README.md for production/container actions. Development must stay
loopback-only; NODE_ENV=production cannot select unauthenticated mode. Validate
owner token/origins before creating pool/listener. All methods including HEAD and
unknown routes are protected except exact GET health and valid CORS preflight.
CORS is not authorization. Preserve auth-before-body/SQL and safe response headers.
Never embed runtime secrets in a Vite build, Docker layer or durable offline store.
The shared owner token is one principal, not user isolation. Hosted TLS/private DB,
rate limits, quotas/backups, bounded dataset and frontend credential UX must precede
claiming public end-to-end sync. Keep migrations explicit and production DB off tests.
