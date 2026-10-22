import { describe, expect, it } from 'vitest'
import { generateDeleteSQL, generateUpdateSQL, type StagedChange } from '../src/lib/staged-changes'

describe('staged changes without primary keys', () => {
  const base: StagedChange = {
    id: 'test', type: 'update', rowCount: 1, createdAt: new Date(),
    tables: [{ schemaName: 'public', tableName: 'items', primaryKeyColumns: [], rows: [{ body: 'new' }] }],
    originalRows: [{ id: '1', body: 'old', payload: null, empty: '' }],
  }

  it('matches all original values, preserving NULL and empty text', () => {
    expect(generateUpdateSQL(base)).toBe('UPDATE "public"."items" SET "body" = \'new\' WHERE "id" = \'1\' AND "body" = \'old\' AND "payload" IS NULL AND "empty" = \'\';')
  })

  it('matches all row values for deletes when no primary key is available', () => {
    const change = { ...base, type: 'delete' as const, tables: [{ ...base.tables[0], rows: base.originalRows! }] }
    expect(generateDeleteSQL(change)).toContain('WHERE "id" = \'1\' AND "body" = \'old\' AND "payload" IS NULL')
  })

  it('does not generate updates or deletes without a WHERE condition', () => {
    expect(generateUpdateSQL({ ...base, originalRows: [{}] })).toBe('')
    expect(generateDeleteSQL({ ...base, tables: [{ ...base.tables[0], rows: [{}] }] })).toBe('')
  })

  it('casts array literals so Duckgres can compare original array values', () => {
    const sql = generateUpdateSQL({
      ...base,
      tables: [{ ...base.tables[0], columnTypes: { tags: 'character varying[]' } }],
      originalRows: [{ id: '1', tags: '{a,"b,c"}' }],
    })
    expect(sql).toContain('"tags" = \'{a,"b,c"}\'::character varying[]')
  })
})
