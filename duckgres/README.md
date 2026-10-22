# Duckgres compatibility

Start the local Duckgres + DuckLake + RustFS environment with `just duckgres-up`.
The pgconsole Docker image for this fork is `ghcr.io/accademiaforense/pgconsole:latest`.

Table/view previews default to **10 rows** on all connections. SQL written manually
is not modified or capped.

## AI assistant

Configure an AI provider in the pgconsole TOML configuration as usual. For example,
for a local OpenAI-compatible server:

```toml
[[ai.providers]]
id = "local"
vendor = "openai-compatible"
model = "your-model"
base_url = "http://host.docker.internal:11434/v1"
```

The test compose file only configures the database connection; add the provider to
its `pgconsole_config` content or mount your own TOML. Do not commit API keys.
Schema access uses the same authentication/IAM checks as the schema browser.
Schema metadata and the messages/SQL supplied to AI features are sent to the
configured provider.

Duckgres is detected from its server banner. AI prompts account for DuckDB/DuckLake
limitations while using PostgreSQL-compatible syntax, which pgconsole's SQL parser
also requires. This is not support for arbitrary DuckDB-only syntax.

## Engine limitations

- Duckgres does not expose PostgreSQL grants, stored functions/procedures, or RLS.
  Unsupported metadata is empty; direct requests for PostgreSQL function definitions
  return an explicit unsupported error.
- DuckLake does not enforce PostgreSQL primary/unique/foreign keys. Inline updates
  and deletes without a primary key match original column values; identical rows
  can therefore all match. Review the SQL preview before applying changes.
- Computed/aliased results without reliable source-column metadata are read-only.
- PostgreSQL storage statistics may be unavailable or reported as zero by Duckgres.
- MCP supports Duckgres text/JSON `EXPLAIN`, but not PostgreSQL `BUFFERS`.

## Regression checks

After `pnpm install` (pnpm 10) and `pnpm gen`, run against a disposable database:

```sh
PGCONSOLE_TEST_URL='postgres://user:password@localhost:5432/ducklake?sslmode=require' pnpm test --run tests/database-compat.test.ts
```

The same test runs against PostgreSQL. It creates and removes its own uniquely
named schema. The LLM call is mocked; database queries are real.
