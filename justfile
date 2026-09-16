compose := "docker compose -f duckgres/docker-compose.yml"

default:
    @just --list

# Start the test environment (Duckgres + RustFS + pgconsole dev server)
duckgres-up:
    {{compose}} up -d --wait

# Stop the environment, keeping DuckLake metadata and RustFS objects
duckgres-down:
    {{compose}} down

# Stop the environment and delete all volumes (metadata + objects)
duckgres-reset:
    {{compose}} down -v

# Populate the DuckLake catalog with the ~1.5M row test dataset
duckgres-seed:
    {{compose}} up -d --wait duckgres
    {{compose}} run --rm seed

# Open a psql session against Duckgres (TLS with self-signed cert)
duckgres-psql:
    {{compose}} up -d --wait duckgres
    {{compose}} run --rm --entrypoint psql seed "host=duckgres port=5432 user=ducklake dbname=ducklake sslmode=require"

# Follow Duckgres logs
duckgres-logs:
    {{compose}} logs -f duckgres

# Follow pgconsole dev server logs
pgconsole-logs:
    {{compose}} logs -f pgconsole

# Follow all environment logs
duckgres-logs-all:
    {{compose}} logs -f
