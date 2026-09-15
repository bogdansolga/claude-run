#!/usr/bin/env bash
set -euo pipefail

# Adapted from finances-manager/scripts/db/setup-database.sh.
# This database contains only claude-run's domains: application data, queue
# state, and migration bookkeeping. Finances-manager business schemas are not
# copied into this database.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FINANCES_ENV="${FINANCES_MANAGER_ENV:-/Users/bsolga/Development/Projects/finances-manager/.env}"
PG_BIN="${PG_BIN:-/Applications/Postgres.app/Contents/Versions/18/bin}"
PSQL="${PSQL:-${PG_BIN}/psql}"
CREATEDB="${CREATEDB:-${PG_BIN}/createdb}"
POSTGRES_SUPERUSER="${POSTGRES_SUPERUSER:-postgres}"
POSTGRES_DB="${CLAUDE_RUN_DB_NAME:-claude_run}"
POSTGRES_APP_USER="${CLAUDE_RUN_DB_USER:-claude_run_admin}"

[[ -x "${PSQL}" && -x "${CREATEDB}" ]] || { echo "PostgreSQL client binaries not found: ${PG_BIN}" >&2; exit 1; }
[[ -f "${FINANCES_ENV}" ]] || { echo "Finances-manager env file not found: ${FINANCES_ENV}" >&2; exit 1; }

SOURCE_DATABASE_URL="$(python3 - "${FINANCES_ENV}" <<'PY'
from pathlib import Path
import sys
for line in Path(sys.argv[1]).read_text().splitlines():
    if line.startswith("DATABASE_URL="):
        print(line.split("=", 1)[1].strip().strip('"').strip("'"))
        break
else:
    raise SystemExit("DATABASE_URL is missing")
PY
)"
POSTGRES_HOST="$(python3 -c 'import sys; from urllib.parse import urlparse; print(urlparse(sys.argv[1]).hostname or "localhost")' "${SOURCE_DATABASE_URL}")"
POSTGRES_PORT="$(python3 -c 'import sys; from urllib.parse import urlparse; print(urlparse(sys.argv[1]).port or "5432")' "${SOURCE_DATABASE_URL}")"
POSTGRES_APP_PASSWORD="$(openssl rand -hex 32)"
[[ "${POSTGRES_APP_PASSWORD}" =~ ^[0-9a-f]{64}$ ]] || { echo "openssl did not produce a 32-byte hex password" >&2; exit 1; }

PSQL_ARGS=(--host="${POSTGRES_HOST}" --port="${POSTGRES_PORT}" --username="${POSTGRES_SUPERUSER}")
"${PSQL}" "${PSQL_ARGS[@]}" --dbname=postgres --quiet --command="
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${POSTGRES_APP_USER}') THEN
    CREATE ROLE \"${POSTGRES_APP_USER}\" WITH LOGIN PASSWORD '${POSTGRES_APP_PASSWORD}';
  ELSE
    ALTER ROLE \"${POSTGRES_APP_USER}\" WITH LOGIN PASSWORD '${POSTGRES_APP_PASSWORD}';
  END IF;
END
\$\$;"

DB_EXISTS=$("${PSQL}" "${PSQL_ARGS[@]}" --dbname=postgres --tuples-only --no-align --quiet --command="SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}'" | xargs)
if [[ "${DB_EXISTS}" != "1" ]]; then
  "${CREATEDB}" "${PSQL_ARGS[@]}" --owner="${POSTGRES_APP_USER}" "${POSTGRES_DB}"
else
  "${PSQL}" "${PSQL_ARGS[@]}" --dbname=postgres --quiet --command="ALTER DATABASE \"${POSTGRES_DB}\" OWNER TO \"${POSTGRES_APP_USER}\";"
fi

SCHEMAS=(claude_run pgboss drizzle)
UNUSED_SCHEMAS=(auth inbound outbound holdings banking reconciliation settings)
SCHEMA_SQL=""
for schema in "${UNUSED_SCHEMAS[@]}"; do SCHEMA_SQL+="DROP SCHEMA IF EXISTS \"${schema}\" CASCADE;"; done
for schema in "${SCHEMAS[@]}"; do
  SCHEMA_SQL+="CREATE SCHEMA IF NOT EXISTS \"${schema}\" AUTHORIZATION \"${POSTGRES_APP_USER}\";"
done
SCHEMA_SQL+="GRANT ALL PRIVILEGES ON DATABASE \"${POSTGRES_DB}\" TO \"${POSTGRES_APP_USER}\";"
for schema in "${SCHEMAS[@]}"; do
  SCHEMA_SQL+="GRANT ALL ON SCHEMA \"${schema}\" TO \"${POSTGRES_APP_USER}\";"
  SCHEMA_SQL+="GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA \"${schema}\" TO \"${POSTGRES_APP_USER}\";"
  SCHEMA_SQL+="GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA \"${schema}\" TO \"${POSTGRES_APP_USER}\";"
done
"${PSQL}" "${PSQL_ARGS[@]}" --dbname="${POSTGRES_DB}" --quiet --command="${SCHEMA_SQL}"

# Match finances-manager's DATABASE_URL shape: no sslmode suffix.
# The generated password is hexadecimal, so it is safe in the URL without
# additional escaping.
PROJECT_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
umask 077
cat > "${ROOT_DIR}/.env" <<EOF
DATABASE_URL=${PROJECT_URL}
CLAUDE_RUN_DB_SCHEMA=claude_run
CLAUDE_RUN_JOB_SCHEMA=pgboss
EOF
chmod 600 "${ROOT_DIR}/.env"

# Drizzle and pg-boss receive the URL in finances-manager's shape, with the
# password supplied through libpq so command wrappers cannot redact the URL.
MIGRATION_URL="postgresql://${POSTGRES_APP_USER}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
DATABASE_URL="${MIGRATION_URL}" PGPASSWORD="${POSTGRES_APP_PASSWORD}" bun run db:migrate
DATABASE_URL="${MIGRATION_URL}" PGPASSWORD="${POSTGRES_APP_PASSWORD}" bun -e 'const {Client}=require("pg"); const c=new Client({connectionString:process.env.DATABASE_URL}); await c.connect(); const r=await c.query("select current_database() as database, current_user as user"); console.log(JSON.stringify({database:r.rows[0].database,user:r.rows[0].user})); await c.end()'

echo "Database ready: ${POSTGRES_DB}; schemas: ${SCHEMAS[*]}; credentials stored in ${ROOT_DIR}/.env"

unset POSTGRES_APP_PASSWORD PROJECT_URL SOURCE_DATABASE_URL MIGRATION_URL
