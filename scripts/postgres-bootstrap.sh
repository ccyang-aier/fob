#!/bin/sh
set -eu
# Runs only when this Compose project's PostgreSQL volume is first initialized.
# SQL values are passed as psql parameters; credentials never enter a log.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 --set=app_password="$FOB_DATABASE_APP_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_search;
CREATE EXTENSION IF NOT EXISTS ltree;
SELECT format('CREATE ROLE fob_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fob_app')
\gexec
GRANT CONNECT ON DATABASE fob TO fob_app;
GRANT USAGE ON SCHEMA public, paradedb, pdb TO fob_app;
SQL
