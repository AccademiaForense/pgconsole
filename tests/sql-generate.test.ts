import { describe, it, expect } from 'vitest'
import {
  generateSelect,
  generateInsert,
  generateUpdate,
  generateDelete,
  generateCreateTable,
  quoteIdentifier,
} from '../src/lib/sql/generate'

describe('SQL generators', () => {
  it('quotes identifiers without splitting dots or losing embedded quotes', () => {
    expect(quoteIdentifier('a.b"c')).toBe('"a.b""c"')
  })

  it('uses a Duckgres table template without SERIAL or unenforced primary keys', async () => {
    const sql = await generateCreateTable(true)
    expect(sql).toMatch(/bigint|int8/)
    expect(sql).not.toMatch(/serial|primary key/i)
    expect(await generateCreateTable()).toMatch(/serial/i)
  })
  describe('generateSelect', () => {
    it('generates a SELECT statement with LIMIT 10', async () => {
      const result = await generateSelect('users')
      expect(result).toBe(`SELECT
  *
FROM
  users
LIMIT
  10;`)
    })
  })

  describe('generateInsert', () => {
    it('generates an INSERT statement with column placeholders', async () => {
      const columns = [
        { name: 'id', type: 'integer', nullable: false },
        { name: 'name', type: 'varchar', nullable: true },
        { name: 'email', type: 'varchar', nullable: false },
      ]
      const result = await generateInsert('users', columns)
      expect(result).toBe(`INSERT INTO users (
  id,
  name,
  email
)
VALUES (
  '<id>',
  '<name>',
  '<email>'
);`)
    })

    it('returns empty string for empty columns', async () => {
      const result = await generateInsert('users', [])
      expect(result).toBe('')
    })
  })

  describe('generateUpdate', () => {
    it('generates an UPDATE statement with PK in WHERE', async () => {
      const columns = [
        { name: 'id', type: 'integer', nullable: false },
        { name: 'name', type: 'varchar', nullable: true },
        { name: 'email', type: 'varchar', nullable: false },
      ]
      const result = await generateUpdate('users', columns, ['id'])
      expect(result).toBe(`UPDATE users
SET
  name = '<name>',
  email = '<email>'
WHERE
  id = '<id>';`)
    })

    it('uses placeholder comment when no PK', async () => {
      const columns = [
        { name: 'name', type: 'varchar', nullable: true },
        { name: 'email', type: 'varchar', nullable: false },
      ]
      const result = await generateUpdate('users', columns, [])
      expect(result).toBe(`UPDATE users
SET
  name = '<name>',
  email = '<email>'
WHERE
  /* condition */;`)
    })

    it('handles composite primary keys', async () => {
      const columns = [
        { name: 'user_id', type: 'integer', nullable: false },
        { name: 'role_id', type: 'integer', nullable: false },
        { name: 'created_at', type: 'timestamp', nullable: false },
      ]
      const result = await generateUpdate('user_roles', columns, ['user_id', 'role_id'])
      expect(result).toBe(`UPDATE user_roles
SET
  created_at = '<created_at>'
WHERE
  user_id = '<user_id>'
  AND role_id = '<role_id>';`)
    })

    it('returns empty string for empty columns', async () => {
      const result = await generateUpdate('users', [], ['id'])
      expect(result).toBe('')
    })
  })

  describe('generateDelete', () => {
    it('generates a DELETE statement with PK in WHERE', async () => {
      const result = await generateDelete('users', ['id'])
      expect(result).toBe(`DELETE FROM users
WHERE
  id = '<id>';`)
    })

    it('uses placeholder comment when no PK', async () => {
      const result = await generateDelete('users', [])
      expect(result).toBe(`DELETE FROM users
WHERE
  /* condition */;`)
    })

    it('handles composite primary keys', async () => {
      const result = await generateDelete('user_roles', ['user_id', 'role_id'])
      expect(result).toBe(`DELETE FROM user_roles
WHERE
  user_id = '<user_id>'
  AND role_id = '<role_id>';`)
    })
  })
})
