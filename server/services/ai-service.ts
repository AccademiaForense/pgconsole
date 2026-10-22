import { ConnectError, Code } from '@connectrpc/connect'
import type { ServiceImpl } from '@connectrpc/connect'
import { AIService } from '../../src/gen/ai_connect'
import { getAIProviders, getAIProviderById } from '../lib/config'
import { buildConnectionDetails, type ConnectionDetails } from '../lib/db'
import { generateWithVendor } from '../ai/vendors'
import { getConnectionInfo, isDuckgres } from '../lib/connection-cache'
import { getSchemaCache, refreshSchemaCache } from '../lib/schema-cache'
import { getUserFromContext } from '../connect'
import { requireAnyPermission } from '../lib/iam'
import {
  TEXT_TO_SQL,
  EXPLAIN_SQL,
  FIX_SQL,
  REWRITE_SQL,
  ASSESS_RISK,
  buildSystemPrompt,
} from '../ai/prompts'

// Helper: Remove markdown code blocks from SQL
function cleanSQLResponse(sql: string): string {
  return sql
    .replace(/^```sql\s*/i, '')  // Remove opening ```sql with any whitespace
    .replace(/^```\s*/, '')       // Remove opening ``` with any whitespace
    .replace(/\s*```\s*$/g, '')   // Remove closing ``` with any surrounding whitespace
    .trim()
}

function getConnectionDetails(connectionId: string): ConnectionDetails {
  const details = buildConnectionDetails(connectionId)
  if (!details) {
    throw new ConnectError('Connection not found', Code.NotFound)
  }
  return details
}

async function getOrRefreshSchema(connectionId: string, schemas: string[], appUser?: string): Promise<string> {
  // Check cache first
  let cached = await getSchemaCache(connectionId, schemas)

  // Refresh if not cached
  if (!cached) {
    const details = getConnectionDetails(connectionId)
    const { version } = getConnectionInfo(connectionId)
    cached = await refreshSchemaCache(connectionId, details, schemas, version, appUser)
  }

  return cached.formatted
}

interface ParsedRiskAssessment {
  overallRisk: string
  findings: Array<{ severity: string; category: string; description: string }>
  dependencyGraph: string
}

function parseRiskAssessment(response: string): ParsedRiskAssessment {
  // Extract mermaid code block if present
  let dependencyGraph = ''
  const mermaidMatch = response.match(/```mermaid\n([\s\S]*?)```/)
  if (mermaidMatch) {
    dependencyGraph = mermaidMatch[1].trim()
    // Strip the mermaid block so it doesn't end up in finding descriptions
    response = response.replace(/```mermaid\n[\s\S]*?```/, '').trim()
  }

  const lines = response.trim().split('\n')

  // Extract overall risk from first line
  const firstLine = lines[0].trim().toUpperCase()
  const overallRisk = firstLine.match(/\b(HIGH|MODERATE|LOW)\b/)?.[1] || 'MODERATE'

  // Parse findings by finding ### headers
  const findings: Array<{ severity: string; category: string; description: string }> = []
  let currentFinding: { severity: string; category: string; description: string } | null = null

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    const headerMatch = line.match(/^###\s*\[(HIGH|MODERATE|LOW)\]\s*(.+)$/i)

    if (headerMatch) {
      // Save previous finding if exists
      if (currentFinding) {
        findings.push(currentFinding)
      }
      // Start new finding
      currentFinding = {
        severity: headerMatch[1].toLowerCase(),
        category: headerMatch[2].trim(),
        description: ''
      }
    } else if (currentFinding && line.trim()) {
      // Accumulate description lines
      currentFinding.description += (currentFinding.description ? '\n' : '') + line
    }
  }

  // Save last finding
  if (currentFinding) {
    findings.push(currentFinding)
  }

  // If no findings parsed, create a default one
  if (findings.length === 0) {
    findings.push({
      severity: overallRisk.toLowerCase(),
      category: 'Assessment Result',
      description: response.substring(firstLine.length).trim() || 'Risk assessment completed.'
    })
  }

  return { overallRisk: overallRisk.toLowerCase(), findings, dependencyGraph }
}

export const aiServiceHandlers: ServiceImpl<typeof AIService> = {
  async listAIProviders(_req, context) {
    const user = await getUserFromContext(context.values)
    if (!user) throw new ConnectError('Authentication required', Code.Unauthenticated)
    const providers = getAIProviders()
    return {
      providers: providers.map((p) => ({
        id: p.id,
        name: p.name ?? p.id,
        vendor: p.vendor,
        model: p.model,
      })),
    }
  },

  async generateSQL(req, context) {
    if (!req.connectionId) {
      throw new ConnectError('connection_id is required', Code.InvalidArgument)
    }
    const user = await getUserFromContext(context.values)
    requireAnyPermission(user, req.connectionId)
    if (!req.providerId) {
      throw new ConnectError('provider_id is required', Code.InvalidArgument)
    }
    if (!req.prompt?.trim()) {
      throw new ConnectError('prompt is required', Code.InvalidArgument)
    }

    const provider = getAIProviderById(req.providerId)
    if (!provider) {
      throw new ConnectError(`AI provider not found: ${req.providerId}`, Code.NotFound)
    }

    try {
      const schema = await getOrRefreshSchema(req.connectionId, req.schemas, user?.email)
      const { version } = getConnectionInfo(req.connectionId)

      const systemPrompt = buildSystemPrompt(TEXT_TO_SQL.system, schema, version, isDuckgres(req.connectionId))

      const result = await generateWithVendor(
        provider.vendor,
        provider.api_key,
        provider.model,
        systemPrompt,
        TEXT_TO_SQL.user({ prompt: req.prompt }),
        req.sessionId || '',
        provider.base_url
      )

      return { sql: cleanSQLResponse(result.sql), error: '', sessionId: result.sessionId }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate SQL'
      return { sql: '', error: message, sessionId: '' }
    }
  },

  async explainSQL(req, context) {
    if (!req.connectionId) {
      throw new ConnectError('connection_id is required', Code.InvalidArgument)
    }
    const user = await getUserFromContext(context.values)
    requireAnyPermission(user, req.connectionId)
    if (!req.providerId) {
      throw new ConnectError('provider_id is required', Code.InvalidArgument)
    }
    if (!req.sql?.trim()) {
      throw new ConnectError('sql is required', Code.InvalidArgument)
    }

    const provider = getAIProviderById(req.providerId)
    if (!provider) {
      throw new ConnectError(`AI provider not found: ${req.providerId}`, Code.NotFound)
    }

    try {
      const schema = await getOrRefreshSchema(req.connectionId, req.schemas, user?.email)
      const { version } = getConnectionInfo(req.connectionId)

      const systemPrompt = buildSystemPrompt(EXPLAIN_SQL.system, schema, version, isDuckgres(req.connectionId))

      // For initial request, use the template
      // For follow-up questions (when sessionId exists), pass the message as-is
      const userPrompt = req.sessionId
        ? req.sql
        : EXPLAIN_SQL.user({ sql: req.sql })

      const result = await generateWithVendor(
        provider.vendor,
        provider.api_key,
        provider.model,
        systemPrompt,
        userPrompt,
        req.sessionId || '',
        provider.base_url
      )

      return { explanation: result.sql, error: '', sessionId: result.sessionId }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to explain SQL'
      return { explanation: '', error: message, sessionId: '' }
    }
  },

  async fixSQL(req, context) {
    if (!req.connectionId) {
      throw new ConnectError('connection_id is required', Code.InvalidArgument)
    }
    const user = await getUserFromContext(context.values)
    requireAnyPermission(user, req.connectionId)
    if (!req.providerId) {
      throw new ConnectError('provider_id is required', Code.InvalidArgument)
    }
    if (!req.sql?.trim()) {
      throw new ConnectError('sql is required', Code.InvalidArgument)
    }
    if (!req.errorMessage?.trim()) {
      throw new ConnectError('error_message is required', Code.InvalidArgument)
    }

    const provider = getAIProviderById(req.providerId)
    if (!provider) {
      throw new ConnectError(`AI provider not found: ${req.providerId}`, Code.NotFound)
    }

    try {
      const schema = await getOrRefreshSchema(req.connectionId, req.schemas, user?.email)
      const { version } = getConnectionInfo(req.connectionId)

      const systemPrompt = buildSystemPrompt(FIX_SQL.system, schema, version, isDuckgres(req.connectionId))
      const userPrompt = FIX_SQL.user({ sql: req.sql, errorMessage: req.errorMessage })

      const result = await generateWithVendor(
        provider.vendor,
        provider.api_key,
        provider.model,
        systemPrompt,
        userPrompt,
        '',
        provider.base_url
      )

      return { sql: cleanSQLResponse(result.sql), error: '' }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fix SQL'
      return { sql: '', error: message }
    }
  },

  async rewriteSQL(req, context) {
    if (!req.connectionId) {
      throw new ConnectError('connection_id is required', Code.InvalidArgument)
    }
    const user = await getUserFromContext(context.values)
    requireAnyPermission(user, req.connectionId)
    if (!req.providerId) {
      throw new ConnectError('provider_id is required', Code.InvalidArgument)
    }
    if (!req.sql?.trim()) {
      throw new ConnectError('sql is required', Code.InvalidArgument)
    }

    const provider = getAIProviderById(req.providerId)
    if (!provider) {
      throw new ConnectError(`AI provider not found: ${req.providerId}`, Code.NotFound)
    }

    try {
      const schema = await getOrRefreshSchema(req.connectionId, req.schemas, user?.email)
      const { version } = getConnectionInfo(req.connectionId)

      const systemPrompt = buildSystemPrompt(REWRITE_SQL.system, schema, version, isDuckgres(req.connectionId))
      const userPrompt = REWRITE_SQL.user({ sql: req.sql })

      const result = await generateWithVendor(
        provider.vendor,
        provider.api_key,
        provider.model,
        systemPrompt,
        userPrompt,
        '',
        provider.base_url
      )

      return { sql: cleanSQLResponse(result.sql), error: '' }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to rewrite SQL'
      return { sql: '', error: message }
    }
  },

  async refreshSchemaCache(req, context) {
    if (!req.connectionId) {
      throw new ConnectError('connection_id is required', Code.InvalidArgument)
    }
    const user = await getUserFromContext(context.values)
    requireAnyPermission(user, req.connectionId)

    try {
      const details = getConnectionDetails(req.connectionId)
      const { version } = getConnectionInfo(req.connectionId)

      await refreshSchemaCache(req.connectionId, details, req.schemas, version, user?.email)

      return { success: true, error: '' }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refresh schema cache'
      return { success: false, error: message }
    }
  },

  async assessChangeRisk(req, context) {
    if (!req.connectionId) {
      throw new ConnectError('connection_id is required', Code.InvalidArgument)
    }
    const user = await getUserFromContext(context.values)
    requireAnyPermission(user, req.connectionId)
    if (!req.providerId) {
      throw new ConnectError('provider_id is required', Code.InvalidArgument)
    }
    if (!req.sqlStatements || req.sqlStatements.length === 0) {
      throw new ConnectError('sql_statements is required', Code.InvalidArgument)
    }

    const provider = getAIProviderById(req.providerId)
    if (!provider) {
      throw new ConnectError(`AI provider not found: ${req.providerId}`, Code.NotFound)
    }

    try {
      const schema = await getOrRefreshSchema(req.connectionId, req.schemas, user?.email)

      const { version } = getConnectionInfo(req.connectionId)
      const systemPrompt = buildSystemPrompt(ASSESS_RISK.system, schema, version, isDuckgres(req.connectionId))
      const userPrompt = ASSESS_RISK.user({ sqlStatements: req.sqlStatements.join('\n\n') })

      const result = await generateWithVendor(
        provider.vendor,
        provider.api_key,
        provider.model,
        systemPrompt,
        userPrompt,
        '',
        provider.base_url
      )

      // Note: result.sql contains the assessment text, not SQL
      const parsed = parseRiskAssessment(result.sql)

      return {
        overallRisk: parsed.overallRisk,
        findings: parsed.findings,
        error: '',
        dependencyGraph: parsed.dependencyGraph,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to assess change risk'
      return { overallRisk: '', findings: [], error: message, dependencyGraph: '' }
    }
  },
}
