import { createClient, type ConnectionDetails } from './db'
import { isDuckgres } from './connection-cache'

export interface CachedSchemaInfo {
  formatted: string // Formatted string for AI context
  lastUpdated: number // Timestamp
  schemaKey: string
}

// Cache: connectionId -> schema info
const schemaCache = new Map<string, CachedSchemaInfo>()

export async function getSchemaCache(connectionId: string, schemas: string[] = []): Promise<CachedSchemaInfo | null> {
  const cached = schemaCache.get(connectionId)
  return cached?.schemaKey === JSON.stringify([...new Set(schemas)].sort()) ? cached : null
}

export async function refreshSchemaCache(
  connectionId: string,
  connectionDetails: ConnectionDetails,
  schemas: string[],
  version: string,
  appUser?: string
): Promise<CachedSchemaInfo> {
  const database = isDuckgres(connectionId) ? 'Duckgres (DuckDB)' : `PostgreSQL ${version}`
  const formatted = await buildSchemaContext(connectionDetails, schemas, database, appUser)
  const cached: CachedSchemaInfo = {
    formatted,
    lastUpdated: Date.now(),
    schemaKey: JSON.stringify([...new Set(schemas)].sort()),
  }
  schemaCache.set(connectionId, cached)
  return cached
}

export function clearSchemaCache(connectionId?: string): void {
  if (connectionId) {
    schemaCache.delete(connectionId)
  } else {
    schemaCache.clear()
  }
}

// Internal types for schema building
interface ColumnData {
  name: string
  type: string
  nullable: boolean
  default: string | null
  comment: string | null
}

interface ConstraintData {
  schema_name: string
  table_name: string
  constraint_name: string
  constraint_type: string
  columns: string[]
  foreign_table: string | null
  foreign_columns: string[]
}

interface IndexData {
  schema_name: string
  table_name: string
  index_name: string
  is_unique: boolean
  is_primary: boolean
  columns: string[]
  index_def: string
}

interface TableData {
  schema: string
  table: string
  objectType: string
  comment: string | null
  columns: ColumnData[]
  constraints: ConstraintData[]
  indexes: IndexData[]
}

async function buildSchemaContext(
  details: ConnectionDetails,
  schemas: string[],
  database: string,
  appUser?: string
): Promise<string> {
  const client = createClient(details, appUser)

  try {
    // Get tables with columns, constraints, and comments
    const tables = await client`
      SELECT
        n.nspname as schema_name,
        c.relname as table_name,
        obj_description(c.oid, 'pg_class') as table_comment,
        CASE c.relkind
          WHEN 'r' THEN 'TABLE'
          WHEN 'p' THEN 'TABLE'
          WHEN 'v' THEN 'VIEW'
          WHEN 'm' THEN 'MATERIALIZED VIEW'
        END as object_type,
        a.attname as column_name,
        format_type(a.atttypid, a.atttypmod) as column_type,
        NOT a.attnotnull as nullable,
        pg_get_expr(ad.adbin, ad.adrelid) as column_default,
        col_description(c.oid, a.attnum) as column_comment
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
      WHERE c.relkind IN ('r', 'p', 'v', 'm')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ${schemas.length > 0 ? client`AND n.nspname IN ${client(schemas)}` : client``}
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY n.nspname, c.relname, a.attnum
    `

    // Get constraints (PK, FK, Unique, Check)
    const constraints = await client`
      SELECT
        n.nspname as schema_name,
        c.relname as table_name,
        con.conname as constraint_name,
        con.contype as constraint_type,
        CASE con.contype
          WHEN 'p' THEN array_agg(a.attname ORDER BY array_position(con.conkey, a.attnum))
          WHEN 'u' THEN array_agg(a.attname ORDER BY array_position(con.conkey, a.attnum))
          WHEN 'c' THEN ARRAY[pg_get_constraintdef(con.oid)]
          WHEN 'f' THEN array_agg(a.attname ORDER BY array_position(con.conkey, a.attnum))
          ELSE ARRAY[]::text[]
        END as columns,
        con.confrelid::regclass::text as foreign_table,
        CASE con.contype
          WHEN 'f' THEN array_agg(af.attname ORDER BY array_position(con.confkey, af.attnum))
          ELSE ARRAY[]::text[]
        END as foreign_columns
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND array_position(con.conkey, a.attnum) IS NOT NULL
      LEFT JOIN pg_attribute af ON af.attrelid = con.confrelid AND array_position(con.confkey, af.attnum) IS NOT NULL
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ${schemas.length > 0 ? client`AND n.nspname IN ${client(schemas)}` : client``}
        AND con.contype IN ('p', 'f', 'u', 'c')
      GROUP BY n.nspname, c.relname, con.conname, con.contype, con.oid, con.confrelid
      ORDER BY n.nspname, c.relname, con.contype
    `

    // Get indexes
    const indexes = await client`
      SELECT
        n.nspname as schema_name,
        c.relname as table_name,
        i.relname as index_name,
        ix.indisunique as is_unique,
        ix.indisprimary as is_primary,
        array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) as columns,
        pg_get_indexdef(ix.indexrelid) as index_def
      FROM pg_index ix
      JOIN pg_class c ON c.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND array_position(ix.indkey::smallint[], a.attnum) IS NOT NULL
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ${schemas.length > 0 ? client`AND n.nspname IN ${client(schemas)}` : client``}
        AND NOT ix.indisprimary  -- Exclude PK indexes (shown in constraints)
      GROUP BY n.nspname, c.relname, i.relname, ix.indisunique, ix.indisprimary, ix.indexrelid
      ORDER BY n.nspname, c.relname, i.relname
    `

    // Build schema context output
    const schemaMap = new Map<string, TableData>()

    // Group tables
    for (const t of tables) {
      const key = `${t.schema_name}.${t.table_name}`
      if (!schemaMap.has(key)) schemaMap.set(key, {
        schema: t.schema_name,
        table: t.table_name,
        objectType: t.object_type,
        comment: t.table_comment,
        columns: [],
        constraints: [],
        indexes: [],
      })
      schemaMap.get(key)!.columns.push({
        name: t.column_name,
        type: t.column_type,
        nullable: t.nullable,
        default: t.column_default,
        comment: t.column_comment,
      })
    }

    // Add constraints
    for (const con of constraints) {
      const key = `${con.schema_name}.${con.table_name}`
      const table = schemaMap.get(key)
      if (table) {
        table.constraints.push(con)
      }
    }

    // Add indexes
    for (const idx of indexes) {
      const key = `${idx.schema_name}.${idx.table_name}`
      const table = schemaMap.get(key)
      if (table) {
        table.indexes.push(idx)
      }
    }

    // Format output
    const lines: string[] = []
    lines.push(database)
    lines.push('')

    for (const table of schemaMap.values()) {
      // Table header
      lines.push(`${table.schema}.${table.table} (${table.objectType})`)
      if (table.comment) {
        lines.push(`  -- ${table.comment}`)
      }

      // Columns
      lines.push('  Columns:')
      for (const col of table.columns) {
        const parts = [col.name, col.type]
        const attrs: string[] = []
        if (!col.nullable) attrs.push('NOT NULL')
        if (col.default) attrs.push(`DEFAULT ${col.default}`)
        if (attrs.length > 0) parts.push(`(${attrs.join(', ')})`)
        let line = `    ${parts.join(': ')}`
        if (col.comment) line += ` -- ${col.comment}`
        lines.push(line)
      }

      // Constraints
      const pkConstraints = table.constraints.filter(c => c.constraint_type === 'p')
      const fkConstraints = table.constraints.filter(c => c.constraint_type === 'f')
      const uniqueConstraints = table.constraints.filter(c => c.constraint_type === 'u')
      const checkConstraints = table.constraints.filter(c => c.constraint_type === 'c')

      if (pkConstraints.length > 0) {
        lines.push('  Primary Key:')
        for (const pk of pkConstraints) {
          lines.push(`    ${pk.columns.join(', ')}`)
        }
      }

      if (fkConstraints.length > 0) {
        lines.push('  Foreign Keys:')
        for (const fk of fkConstraints) {
          lines.push(`    ${fk.columns.join(', ')} -> ${fk.foreign_table}(${fk.foreign_columns.join(', ')})`)
        }
      }

      if (uniqueConstraints.length > 0) {
        lines.push('  Unique Constraints:')
        for (const uc of uniqueConstraints) {
          lines.push(`    ${uc.columns.join(', ')}`)
        }
      }

      if (checkConstraints.length > 0) {
        lines.push('  Check Constraints:')
        for (const cc of checkConstraints) {
          lines.push(`    ${cc.columns[0]}`)  // CHECK constraint definition
        }
      }

      // Indexes
      if (table.indexes.length > 0) {
        lines.push('  Indexes:')
        for (const idx of table.indexes) {
          const unique = idx.is_unique ? 'UNIQUE ' : ''
          lines.push(`    ${unique}${idx.index_name} (${idx.columns.join(', ')})`)
        }
      }

      lines.push('') // Empty line between tables
    }

    return lines.join('\n')
  } finally {
    await client.end()
  }
}
