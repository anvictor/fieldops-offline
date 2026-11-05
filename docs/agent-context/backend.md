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
CORS; Render/Neon rollout and the reviewed owner-entry UX are described in docs/render-neon-deployment.md. Per-user isolation, pagination and full operational hardening remain outside this private demo.
Pages deploys only the PWA and does not run server startup or migrations.

Migrations execute explicitly in filename order, transactionally with a ledger
and advisory lock. Add new numbered migrations when authorized; never rewrite
applied ones. Preserve persistent volumes and configuration. Changing environment
credentials does not change passwords in an existing volume. Compiled installs
need migrations retained alongside server output.

## REST and sync limits

Inspection data writes accept title/status and optional CREATE UUID; versioned CREATE/PATCH also carry mutationId, and PATCH requires expectedVersion. Titles are
trimmed 1–200 Unicode characters without null; status is draft/completed. Partial
updates preserve omitted fields, ID and createdAt. SQL values are parameterized.
JSON writes enforce type/size validation; safe errors omit stack/DB details.
Health reports process liveness, not database readiness.

CREATE supports client UUID replay: new 201, matching normalized title/status
200, different content 409 `ID_CONFLICT`; concurrent replay uses DB uniqueness.
Missing inspection GET/PATCH/DELETE returns JSON `INSPECTION_NOT_FOUND`, distinct
from unknown-route `NOT_FOUND`. Client DELETE may confirm missing; PATCH blocks.
An authenticated bounded snapshot now provides download and explicit deletion awareness. Title/status PATCH uses atomic expectedVersion fencing and durable CREATE/PATCH receipts; no per-user accounts or automatic content merge exists. Preserve these boundaries; do not imply exactly-once
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


TASK021 adds migration002 permanent retired UUIDs; POST/DELETE serialize identity transactions, including retirement on authenticated valid DELETE404. Retired CREATE returns409 INSPECTION_DELETED. Snapshot route precedes:id, uses one SQL snapshot and rejects either collection above5000 (no partial/truncated apply). Backend release/migration must precede frontend; migration001 remains unchanged. Tombstones cover deletions from rollout onward, not unavailable pre-migration history.


TASK022 migration003 adds positive inspection versions and permanent mutation
receipts. Versioned CREATE/PATCH receipt lookup precedes mutation; exact normalized
request/identity replay returns the original ACK even after edits/deletion. PATCH
atomically predicates UPDATE by id/version and increments once; conflict409 includes
current row, unversioned/invalid PATCH400 VERSION_REQUIRED fails closed. All reads
and successful write ACKs carry version. DELETE is unchanged/unconditional.
Backend/migration rollout precedes frontend; do not downgrade to unfenced writes.
