import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Code, type HandlerContext } from '@connectrpc/connect'
import '../server/connect'
import { aiServiceHandlers as ai } from '../server/services/ai-service'
import { loadConfigFromString } from '../server/lib/config'
import { setConnectionVersion, clearConnectionCache, isDuckgres, testAndCacheConnection } from '../server/lib/connection-cache'
import { clearSchemaCache } from '../server/lib/schema-cache'
import { createClient } from '../server/lib/db'
import { generateWithVendor } from '../server/ai/vendors'
import { buildSystemPrompt, TEXT_TO_SQL } from '../server/ai/prompts'
import * as A from '../src/gen/ai_pb'

vi.mock('../server/lib/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('../server/lib/db')>(),
  createClient: vi.fn(),
}))
vi.mock('../server/ai/vendors', () => ({
  generateWithVendor: vi.fn(async () => ({ sql: 'SELECT 1', sessionId: '' })),
}))

const config = `
[auth]
jwt_secret = "test-secret-key-at-least-32-characters-long"
[[users]]
email = "allowed@example.com"
[[users]]
email = "denied@example.com"
[[connections]]
id = "db"
name = "Database"
host = "localhost"
database = "test"
username = "postgres"
[[ai.providers]]
id = "local"
vendor = "openai-compatible"
model = "test"
base_url = "http://localhost:1/v1"
[[iam]]
connection = "db"
permissions = ["read"]
members = ["user:allowed@example.com"]
`

function context(email?: string): HandlerContext {
  return { values: new Map(email ? [['user', { email }]] : []) } as unknown as HandlerContext
}

const request = { connectionId: 'db', providerId: 'local', schemas: ['public'], sessionId: 'existing-session' }
const calls = [
  ['generate', (ctx: HandlerContext) => ai.generateSQL(new A.GenerateSQLRequest({ ...request, prompt: 'Show items' }), ctx)],
  ['explain', (ctx: HandlerContext) => ai.explainSQL(new A.ExplainSQLRequest({ ...request, sql: 'SELECT 1' }), ctx)],
  ['fix', (ctx: HandlerContext) => ai.fixSQL(new A.FixSQLRequest({ ...request, sql: 'SELECT', errorMessage: 'syntax error' }), ctx)],
  ['rewrite', (ctx: HandlerContext) => ai.rewriteSQL(new A.RewriteSQLRequest({ ...request, sql: 'SELECT 1' }), ctx)],
  ['assess risk', (ctx: HandlerContext) => ai.assessChangeRisk(new A.AssessChangeRiskRequest({ ...request, sqlStatements: ['DELETE FROM items'] }), ctx)],
  ['refresh schema', (ctx: HandlerContext) => ai.refreshSchemaCache(new A.RefreshSchemaCacheRequest(request), ctx)],
] as const

beforeEach(async () => {
  vi.clearAllMocks()
  clearConnectionCache()
  clearSchemaCache()
  const sql = Object.assign(vi.fn().mockResolvedValue([]), { end: vi.fn().mockResolvedValue(undefined) })
  vi.mocked(createClient).mockReturnValue(sql as unknown as ReturnType<typeof createClient>)
  await loadConfigFromString(config)
  setConnectionVersion('db', '15', 'PostgreSQL 15.0 (Duckgres/DuckDB)')
})

describe('AI authorization', () => {
  it.each(calls)('rejects unauthenticated %s calls before database/provider access', async (_name, call) => {
    await expect(call(context())).rejects.toMatchObject({ code: Code.Unauthenticated })
    expect(createClient).not.toHaveBeenCalled()
    expect(generateWithVendor).not.toHaveBeenCalled()
  })

  it.each(calls)('hides inaccessible connections for %s, including follow-ups', async (_name, call) => {
    await expect(call(context('denied@example.com'))).rejects.toMatchObject({ code: Code.NotFound })
    expect(createClient).not.toHaveBeenCalled()
    expect(generateWithVendor).not.toHaveBeenCalled()
  })

  it('allows an authorized follow-up and keeps no-auth deployments working', async () => {
    const call = calls[0][1]
    await expect(call(context('allowed@example.com'))).resolves.toMatchObject({ sql: 'SELECT 1', error: '' })
    await loadConfigFromString(config.replace(/\[auth\]\njwt_secret = .*\n/, ''))
    await expect(call(context('guest'))).resolves.toMatchObject({ sql: 'SELECT 1', error: '' })
  })

  it('does not list providers to anonymous callers', async () => {
    await expect(ai.listAIProviders(new A.ListAIProvidersRequest(), context())).rejects.toMatchObject({ code: Code.Unauthenticated })
  })
})

describe('Duckgres detection and prompts', () => {
  it('preserves the server banner without changing the PostgreSQL major version', async () => {
    const sql = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ version: 'PostgreSQL 15.0 (Duckgres/DuckDB)' }])
    expect(await testAndCacheConnection(sql as unknown as ReturnType<typeof createClient>, 'db')).toBe('15')
    expect(isDuckgres('db')).toBe(true)
    setConnectionVersion('db', '17', 'PostgreSQL 17.4')
    expect(isDuckgres('db')).toBe(false)
  })

  it('keeps PostgreSQL prompts and adds Duckgres-specific guidance only for Duckgres', () => {
    const pg = buildSystemPrompt(TEXT_TO_SQL.system, 'schema', '17')
    expect(pg).toContain('PostgreSQL 17 syntax')
    expect(pg).not.toContain('Duckgres')
    const duckgres = buildSystemPrompt(TEXT_TO_SQL.system, 'schema', '15', true)
    expect(duckgres).toContain('Duckgres')
    expect(duckgres).not.toContain('PostgreSQL 15')
    expect(duckgres).toContain('not DuckDB-only syntax')
    expect(duckgres).toContain('LIMIT 10')
  })
})
