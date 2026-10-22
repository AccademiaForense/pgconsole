import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '@connectrpc/connect'
import '../server/connect'
import { loadConfigFromString } from '../server/lib/config'
import { createClient, type ConnectionDetails } from '../server/lib/db'
import { isDuckgres, testAndCacheConnection } from '../server/lib/connection-cache'
import { getSchemaCache, refreshSchemaCache } from '../server/lib/schema-cache'
import { queryServiceHandlers as query } from '../server/services/query-service'
import { aiServiceHandlers as ai } from '../server/services/ai-service'
import { generateWithVendor } from '../server/ai/vendors'
import { Principal, dispatchTool } from '../server/mcp'
import * as Q from '../src/gen/query_pb'
import { GenerateSQLRequest } from '../src/gen/ai_pb'
import { generateUpdateSQL } from '../src/lib/staged-changes'

vi.mock('../server/ai/vendors', () => ({
  generateWithVendor: vi.fn(async () => ({ sql: 'SELECT 1', sessionId: '' })),
}))

// Run the same checks against PostgreSQL and Duckgres/DuckLake:
// PGCONSOLE_TEST_URL='postgres://user:pass@host:port/database?sslmode=require' pnpm test --run tests/database-compat.test.ts
describe.skipIf(!process.env.PGCONSOLE_TEST_URL)('database compatibility', () => {
  const schema = `pgconsole_test_${Date.now()}`
  const context = { values: new Map([['user', { email: 'guest' }]]) } as unknown as HandlerContext
  const request = { connectionId: 'test', schema, table: 'items' }
  const principal = new Principal({ id: 'test', name: 'Test', token: 'test' })
  let client: ReturnType<typeof createClient>
  let details: ConnectionDetails

  beforeAll(async () => {
    const url = new URL(process.env.PGCONSOLE_TEST_URL!)
    details = {
      host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1),
      username: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      sslMode: url.searchParams.get('sslmode') || 'disable',
    }
    await loadConfigFromString(`
[[connections]]
id = "test"
name = "Test"
host = ${JSON.stringify(details.host)}
port = ${details.port}
database = ${JSON.stringify(details.database)}
username = ${JSON.stringify(details.username)}
password = ${JSON.stringify(details.password)}
ssl_mode = ${JSON.stringify(details.sslMode)}
[[ai.providers]]
id = "test"
vendor = "openai-compatible"
model = "test"
base_url = "http://localhost:1/v1"
`)
    client = createClient(details)
    await testAndCacheConnection(client, 'test')
    await client.unsafe(`CREATE SCHEMA "${schema}"`)
    await client.unsafe(`CREATE TABLE "${schema}".items (
      id integer ${isDuckgres('test') ? '' : 'PRIMARY KEY'}, body text NOT NULL,
      payload json, amount decimal(12,2), tags text[]
    )`)
    await client.unsafe(`INSERT INTO "${schema}".items VALUES
      (1, 'hello', '{"a":1}', 12.34, ARRAY['a','b']), (2, '', NULL, NULL, NULL)`)
    await client.unsafe(`CREATE VIEW "${schema}".item_view AS SELECT id, body FROM "${schema}".items`)
  }, 30000)

  afterAll(async () => {
    if (!client) return
    try {
      await client.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    } finally {
      await client.end()
    }
  })

  async function execute(sql: string) {
    const messages = []
    for await (const message of query.executeSQL(new Q.ExecuteSQLRequest({ connectionId: 'test', sql }), context)) {
      messages.push(message)
    }
    const result = messages.at(-1)!
    expect(result.error).toBe('')
    return result
  }

  async function mcp(name: string, args: Record<string, unknown> = {}) {
    const result = await dispatchTool(principal, name, { connection: 'test', ...args })
    return JSON.parse(result.content[0].text)
  }

  it('browses tables, views, columns and optional PostgreSQL metadata', async () => {
    const schemas = await query.getSchemas(new Q.GetSchemasRequest(request), context)
    expect(schemas.schemas).toContain(schema)
    const tables = await query.getTables(new Q.GetTablesRequest(request), context)
    expect(tables.tables).toEqual([{ name: 'items', type: 'table' }, { name: 'item_view', type: 'view' }])
    const columns = await query.getColumns(new Q.GetColumnsRequest(request), context)
    expect(columns.columns?.map(c => c.name)).toEqual(['id', 'body', 'payload', 'amount', 'tags'])
    expect(columns.columns?.find(c => c.name === 'body')?.nullable).toBe(false)
    expect(columns.columns?.find(c => c.name === 'tags')?.type).toContain('[]')
    const info = await query.getTableInfo(new Q.GetTableInfoRequest(request), context)
    expect(info.metadata?.kind).toBe('table')
    const view = await query.getTableInfo(new Q.GetTableInfoRequest({ ...request, table: 'item_view' }), context)
    expect(view.metadata?.kind).toBe('view')
    await query.getIndexes(new Q.GetIndexesRequest(request), context)
    const constraints = await query.getConstraints(new Q.GetConstraintsRequest(request), context)
    if (!isDuckgres('test')) expect(constraints.constraints?.some(c => c.type === 'PRIMARY KEY')).toBe(true)
    await query.getTriggers(new Q.GetTriggersRequest(request), context)
    await query.getPolicies(new Q.GetPoliciesRequest(request), context)
    await query.getGrants(new Q.GetGrantsRequest(request), context)
    await query.getFunctions(new Q.GetFunctionsRequest(request), context)
    await query.getProcedures(new Q.GetProceduresRequest(request), context)
    await query.getMaterializedViews(new Q.GetMaterializedViewsRequest(request), context)
    const sessions = await query.getActiveSessions(new Q.GetActiveSessionsRequest(request), context)
    expect(sessions.error).toBe('')
  }, 30000)

  it('preserves NULLs, column metadata and read-only computed results', async () => {
    const result = await execute(`SELECT * FROM "${schema}".items ORDER BY id LIMIT 10`)
    expect(result.rows).toHaveLength(2)
    expect(result.rows?.[1].values?.[1]).toBe('')
    expect(result.rows?.[1].nullColumns).toEqual([2, 3, 4])
    expect(result.columns?.find(c => c.name === 'body')).toMatchObject({ tableName: 'items', schemaName: schema, isNullable: false })
    const computed = await execute(`SELECT count(*) AS count FROM "${schema}".items`)
    expect(computed.columns?.[0].tableName).toBe('')
  })

  it('executes writes and transaction-wrapped batches', async () => {
    await execute(`UPDATE "${schema}".items SET body = 'updated' WHERE id = 1`)
    await execute(`INSERT INTO "${schema}".items (id, body) VALUES (3, 'temporary'); DELETE FROM "${schema}".items WHERE id = 3`)
    expect((await execute(`SELECT * FROM "${schema}".items`)).rows).toHaveLength(2)
  })

  it('applies inline updates to rows containing arrays and JSON', async () => {
    const before = await execute(`SELECT * FROM "${schema}".items WHERE id = 1`)
    const columns = before.columns!
    const row = before.rows![0]
    const original = Object.fromEntries(columns.map((c, i) => [c.name!, row.nullColumns?.includes(i) ? null : row.values![i]]))
    expect(['{a,b}', '{"a","b"}']).toContain(original.tags)
    const sql = generateUpdateSQL({
      id: 'inline', type: 'update', rowCount: 1, createdAt: new Date(), originalRows: [original],
      tables: [{ schemaName: schema, tableName: 'items',
        primaryKeyColumns: columns.filter(c => c.isPrimaryKey).map(c => c.name!),
        columnTypes: Object.fromEntries(columns.map(c => [c.name!, c.type!])),
        rows: [{ body: 'inline updated' }],
      }],
    })
    await execute(sql)
    expect((await execute(`SELECT body FROM "${schema}".items WHERE id = 1`)).rows?.[0].values?.[0]).toBe('inline updated')
  })

  it('cancels a running query even when pg_backend_pid returns zero', async () => {
    const sql = isDuckgres('test')
      ? 'SELECT sum(i::bigint) FROM generate_series(1, 100000000) AS t(i)'
      : 'SELECT pg_sleep(5)'
    const stream = query.executeSQL(new Q.ExecuteSQLRequest({ connectionId: 'test', queryId: 'cancel-test', sql }), context)[Symbol.asyncIterator]()
    try {
      await stream.next() // Initial PID message
      const pending = stream.next()
      await new Promise(resolve => setTimeout(resolve, 50))
      const cancelled = await query.cancelQuery(new Q.CancelQueryRequest({ connectionId: 'test', queryId: 'cancel-test' }), context)
      expect(cancelled.cancelled).toBe(true)
      const result = await pending
      expect(result.value?.error).toMatch(/cancel|interrupt/i)
    } finally {
      await stream.return?.()
    }
  }, 20000)

  it('builds the selected schema context and uses it for AI generation', async () => {
    const cached = await refreshSchemaCache('test', details, [schema], '17')
    expect(cached.formatted).toContain(`${schema}.items (TABLE)`)
    expect(cached.formatted).toContain('NOT NULL')
    expect(await getSchemaCache('test', ['missing'])).toBeNull()
    expect(await getSchemaCache('test', [schema])).toBe(cached)
    const result = await ai.generateSQL(new GenerateSQLRequest({ connectionId: 'test', providerId: 'test', schemas: [schema], prompt: 'Show items' }), context)
    expect(result.error).toBe('')
    expect(result.sql).toBe('SELECT 1')
    const systemPrompt = vi.mocked(generateWithVendor).mock.calls.at(-1)?.[3]
    expect(systemPrompt).toContain(`${schema}.items`)
    expect(systemPrompt).toContain(isDuckgres('test') ? 'Duckgres' : 'PostgreSQL')
  })

  it('exposes MCP catalog, query results and text/JSON query plans', async () => {
    expect((await mcp('list_objects', { schema })).objects).toHaveLength(2)
    expect((await mcp('describe_table', { schema, table: 'items' })).columns).toHaveLength(5)
    expect((await mcp('query', { sql: `SELECT * FROM "${schema}".items LIMIT 10` })).returnedRows).toBe(2)
    const sql = `SELECT * FROM "${schema}".items`
    expect((await mcp('explain_query', { sql })).plan).not.toBe('')
    const plan = (await mcp('explain_query', { sql, format: 'json' })).plan
    expect(plan).toBeDefined()
    expect(typeof plan).toBe('object')
    if (isDuckgres('test')) {
      await expect(mcp('explain_query', { sql, analyze: true, buffers: true })).rejects.toThrow('does not support EXPLAIN BUFFERS')
    } else {
      expect((await mcp('explain_query', { sql, analyze: true, buffers: true })).plan).not.toBe('')
    }
  })
})
