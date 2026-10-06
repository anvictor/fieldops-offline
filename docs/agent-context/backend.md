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
by default); PostgreSQL Compose also binds loopback. Public hosting, auth/CORS
policy, pagination and operational hardening are outside the current boundary.
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
No authentication, initial download, multi-device conflict resolution or
server-side fencing exists. Preserve these boundaries; do not imply exactly-once
sync or deployed public API. Disposable `TEST_DATABASE_URL` is mandatory for
integration tests; unique schemas do not make a production database safe to use.
