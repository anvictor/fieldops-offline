#!/bin/sh
set -eu
# Direct verified-TLS connection for migrations; pooled URL stays in the API env.
: "${MIGRATION_DATABASE_URL:?Direct migration connection is required}"
DATABASE_URL="$MIGRATION_DATABASE_URL" node dist/migrate.js
exec node dist/index.js
