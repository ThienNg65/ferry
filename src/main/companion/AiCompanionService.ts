import {
  classifyCommandRisk,
  DEFAULT_GEMINI_ENDPOINT,
  DEFAULT_GEMINI_MODEL,
  escalateCommandRisk,
  normalizeGeminiModel,
  sanitizeCompanionCommand,
  type CompanionAiChatRequest,
  type CompanionAiChatResult,
  type CompanionAiIntent,
  type CompanionAiProvider,
  type CompanionCommandCard,
  type CompanionCommandRisk,
  type CompanionStructuredOutput,
  type CompanionUiActionCard,
  type CompanionWorkspaceSignal
} from '../../shared/contract'
import { AppSettingsStore } from '../app/AppSettingsStore'
import { readJsonWithLimit } from './httpJson'

export { classifyCommandRisk, DEFAULT_GEMINI_ENDPOINT, DEFAULT_GEMINI_MODEL, escalateCommandRisk }

const AI_TIMEOUT_MS = 15_000
const MAX_HISTORY_TURNS = 6
const MAX_HISTORY_TURN_CHARS = 1_000
const MAX_PROMPT_CHARS = 2_000
const MAX_REPLY_CHARS = 4_000
const MAX_AI_RESPONSE_BYTES = 256 * 1024
const MAX_CARDS = 4
const GEMINI_API_REVISION = '2026-05-20'

export const COMPANION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Concise practical summary for the user.' },
    rootCause: { type: 'string', description: 'Optional diagnosed root cause for logs or resource spikes.' },
    commandCards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Exact POSIX shell command to inspect or remediate.' },
          description: { type: 'string', description: 'Brief explanation of what this command does.' },
          risk: { type: 'string', enum: ['read_only', 'mutating', 'destructive'] }
        },
        required: ['command', 'description', 'risk']
      }
    },
    uiActionCards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['open-editor', 'tail-log', 'apply-filter'] },
          label: { type: 'string', description: 'Short button label for the Ferry UI action.' },
          remotePath: { type: 'string', description: 'Remote file path for open-editor or tail-log.' },
          mode: { type: 'string', enum: ['include', 'exclude'] },
          pattern: { type: 'string', description: 'Glob filename pattern for apply-filter.' }
        },
        required: ['kind', 'label']
      }
    }
  },
  required: ['summary']
} as const

function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  return lower === 'localhost' || lower === '127.0.0.1' || lower === '[::1]' || lower === '::1'
}

function sanitizeErrorMessage(err: unknown, apiKey?: string): string {
  let msg = err instanceof Error ? err.message : 'Unable to reach AI provider'
  if (apiKey) {
    msg = msg.split(apiKey).join('[REDACTED]')
  }
  return msg.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s/@]+@/g, '$1[REDACTED]@')
}

function normalizeHistory(
  rawHistory: CompanionAiChatRequest['history']
): Array<{ role: 'user' | 'assistant'; text: string }> {
  if (!Array.isArray(rawHistory)) return []
  return rawHistory
    .slice(-MAX_HISTORY_TURNS)
    .filter(
      (m): m is { role: 'user' | 'assistant'; text: string } =>
        Boolean(
          m &&
            typeof m === 'object' &&
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.text === 'string' &&
            m.text.trim()
        )
    )
    .map((m) => ({
      role: m.role,
      text: m.text.trim().slice(0, MAX_HISTORY_TURN_CHARS)
    }))
}

function normalizeWorkspaceSignal(raw: CompanionWorkspaceSignal | undefined): CompanionWorkspaceSignal | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: CompanionWorkspaceSignal = {}
  if (typeof raw.logPath === 'string' && raw.logPath.trim()) {
    out.logPath = raw.logPath.replace(/[\r\n]+/g, ' ').trim().slice(0, 256)
  }
  if (typeof raw.logSnippet === 'string' && raw.logSnippet.trim()) {
    out.logSnippet = raw.logSnippet.trim().slice(0, 2500)
  }
  if (typeof raw.monitorSummary === 'string' && raw.monitorSummary.trim()) {
    out.monitorSummary = raw.monitorSummary.trim().slice(0, 1500)
  }
  return out.logPath || out.logSnippet || out.monitorSummary ? out : undefined
}

function buildGeminiInteractionsUrl(endpointUrl: URL): string {
  const base = endpointUrl.toString().replace(/\/+$/, '')
  if (base.endsWith('/interactions')) return base
  if (base.endsWith('/v1beta')) return `${base}/interactions`
  return `${base}/v1beta/interactions`
}

function buildTextSuccessResult(provider: CompanionAiProvider, rawText: string): CompanionAiChatResult {
  const structured = parseStructuredCompanionResponse(rawText)
  return {
    ok: true,
    provider,
    text: structured.summary,
    structured
  }
}

export function validateAiEndpoint(provider: CompanionAiProvider, rawEndpoint: string): URL {
  const trimmed = rawEndpoint.trim() || (provider === 'gemini' ? DEFAULT_GEMINI_ENDPOINT : '')
  if (!trimmed) {
    throw new Error(
      provider === 'ferry-pro'
        ? 'Ferry Pro Proxy endpoint URL is required'
        : 'AI endpoint URL is required'
    )
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('AI endpoint must be a valid URL')
  }
  if (parsed.username || parsed.password) {
    throw new Error('AI endpoint URL must not include credentials')
  }
  if (parsed.protocol === 'https:') {
    return parsed
  }
  if (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) {
    return parsed
  }
  throw new Error('Remote AI endpoints must use https:// (http:// is allowed only for localhost)')
}

function buildSystemPrompt(ctx: CompanionAiChatRequest['context'], intent?: CompanionAiIntent): string {
  const intentHint =
    intent === 'explain-log'
      ? 'Focus on diagnosing the redacted log snippet: summarize what happened, provide a concise rootCause, and suggest read-only verification commands or UI actions.'
      : intent === 'diagnose-spike'
        ? 'Focus on triaging the remote Resource Monitor spike: identify likely bottlenecks in rootCause and propose safe inspection Command Cards.'
        : intent === 'command'
          ? 'Translate the user request into safe, accurate POSIX/Linux shell Command Cards with honest risk labels.'
          : 'Answer concisely and suggest Command Cards or Ferry UI Action Cards only when clearly helpful.'

  return [
    'You are Ferry Companion, a concise, trustworthy desktop assistant inside Ferry (an SFTP/SSH client with live log tailing, resource monitoring, and embedded terminal).',
    `Current app context (non-sensitive): Ferry v${ctx.appVersion || 'unknown'}, connected=${ctx.isConnected ? 'yes' : 'no'}, theme=${ctx.theme || 'unknown'}.`,
    intentHint,
    'Rules:',
    '- Respond strictly matching the JSON schema (`summary`, optional `rootCause`, optional `commandCards`, optional `uiActionCards`).',
    '- Keep `summary` under 140 words unless diagnostic steps require more clarity.',
    '- Never claim you executed a command, modified a file, or accessed a remote server directly.',
    '- Classify every command honestly: read_only (inspect/read), mutating (edits/restarts), destructive (deletes/stops/irreversible).',
    '- Never ask for passwords, private keys, or secrets.'
  ].join('\n')
}

function buildUserInput(
  history: Array<{ role: 'user' | 'assistant'; text: string }>,
  sig: CompanionWorkspaceSignal | undefined,
  prompt: string
): string {
  const sections: string[] = []
  if (history.length > 0) {
    const lines = history.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
    sections.push(`Recent conversation:\n${lines.join('\n')}`)
  }

  if (sig) {
    const signalLines: string[] = []
    if (sig.logPath) {
      signalLines.push(`Remote log path: ${sig.logPath}`)
    }
    if (sig.logSnippet) {
      signalLines.push(`Redacted log snippet:\n${sig.logSnippet}`)
    }
    if (sig.monitorSummary) {
      signalLines.push(`Resource monitor snapshot:\n${sig.monitorSummary}`)
    }
    if (signalLines.length > 0) {
      sections.push(signalLines.join('\n\n'))
    }
  }

  sections.push(`Current request:\n${prompt}`)
  return sections.join('\n\n')
}

function sanitizeRisk(raw: unknown): CompanionCommandRisk {
  return raw === 'destructive' || raw === 'mutating' || raw === 'read_only' ? raw : 'read_only'
}

export function normalizeStructuredOutput(raw: unknown): CompanionStructuredOutput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const summary = typeof obj.summary === 'string' ? obj.summary.trim().slice(0, MAX_REPLY_CHARS) : ''
  if (!summary) return null

  const out: CompanionStructuredOutput = { summary }

  if (typeof obj.rootCause === 'string' && obj.rootCause.trim()) {
    out.rootCause = obj.rootCause.trim().slice(0, 1000)
  }

  if (Array.isArray(obj.commandCards)) {
    const cards: CompanionCommandCard[] = []
    for (const item of obj.commandCards) {
      if (!item || typeof item !== 'object' || cards.length >= MAX_CARDS) continue
      const c = item as Record<string, unknown>
      const command = typeof c.command === 'string' ? sanitizeCompanionCommand(c.command) : ''
      const description = typeof c.description === 'string' ? c.description.trim().slice(0, 300) : ''
      if (!command) continue
      cards.push({
        command,
        description: description || 'Run in terminal',
        risk: escalateCommandRisk(sanitizeRisk(c.risk), command)
      })
    }
    if (cards.length > 0) out.commandCards = cards
  }

  if (Array.isArray(obj.uiActionCards)) {
    const actions: CompanionUiActionCard[] = []
    for (const item of obj.uiActionCards) {
      if (!item || typeof item !== 'object' || actions.length >= MAX_CARDS) continue
      const a = item as Record<string, unknown>
      const label = typeof a.label === 'string' ? a.label.trim().slice(0, 80) : ''
      if (!label) continue
      if (a.kind === 'open-editor' || a.kind === 'tail-log') {
        const remotePath = typeof a.remotePath === 'string' ? a.remotePath.trim().slice(0, 512) : ''
        if (remotePath) {
          actions.push({ kind: a.kind, remotePath, label })
        }
      } else if (a.kind === 'apply-filter') {
        const mode = a.mode === 'include' || a.mode === 'exclude' ? a.mode : null
        const pattern = typeof a.pattern === 'string' ? a.pattern.trim().slice(0, 120) : ''
        if (mode && pattern) {
          actions.push({ kind: 'apply-filter', mode, pattern, label })
        }
      }
    }
    if (actions.length > 0) out.uiActionCards = actions
  }

  return out
}

export function parseStructuredCompanionResponse(rawText: string): CompanionStructuredOutput {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  if (cleaned.startsWith('{')) {
    try {
      const parsed = JSON.parse(cleaned) as unknown
      const normalized = normalizeStructuredOutput(parsed)
      if (normalized) return normalized
    } catch {
      // Fall through to plain text wrapper.
    }
  }

  return {
    summary: rawText.trim().slice(0, MAX_REPLY_CHARS)
  }
}

function extractGeminiInteractionText(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const record = data as Record<string, unknown>
  if (typeof record.output_text === 'string' && record.output_text.trim()) {
    return record.output_text
  }
  if (Array.isArray(record.steps)) {
    for (let i = record.steps.length - 1; i >= 0; i--) {
      const step = record.steps[i] as Record<string, unknown> | undefined
      if (step?.type === 'model_output' && Array.isArray(step.content)) {
        const text = step.content
          .map((part) => (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string' ? (part as Record<string, string>).text : ''))
          .join('')
          .trim()
        if (text) return text
      }
    }
  }
  if (Array.isArray(record.candidates) && record.candidates.length > 0) {
    const first = record.candidates[0] as { content?: { parts?: Array<{ text?: unknown }> } }
    const text = (first?.content?.parts ?? [])
      .map((p) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
      .trim()
    if (text) return text
  }
  return ''
}

export interface AiCompanionServiceDeps {
  fetchImpl?: typeof fetch
  getConfig?: () => ReturnType<AppSettingsStore['getDecryptedCompanionAiConfig']>
}

export class AiCompanionService {
  private static instance: AiCompanionService | null = null
  private readonly fetchImpl: typeof fetch
  private readonly getConfig: () => ReturnType<AppSettingsStore['getDecryptedCompanionAiConfig']>

  constructor(deps: AiCompanionServiceDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.getConfig = deps.getConfig ?? (() => AppSettingsStore.getInstance().getDecryptedCompanionAiConfig())
  }

  static getInstance(): AiCompanionService {
    if (!AiCompanionService.instance) {
      AiCompanionService.instance = new AiCompanionService()
    }
    return AiCompanionService.instance
  }

  async chat(request: CompanionAiChatRequest): Promise<CompanionAiChatResult> {
    let config: ReturnType<AppSettingsStore['getDecryptedCompanionAiConfig']>
    try {
      config = this.getConfig()
    } catch (err) {
      return { ok: false, error: sanitizeErrorMessage(err) }
    }
    if (!config || config.provider === 'none') {
      return { ok: false, error: 'AI provider is disabled' }
    }

    const prompt = request.prompt.trim().slice(0, MAX_PROMPT_CHARS)
    if (!prompt) {
      return { ok: false, error: 'Prompt is empty' }
    }

    let endpointUrl: URL
    try {
      endpointUrl = validateAiEndpoint(config.provider, config.endpoint)
    } catch (err) {
      return { ok: false, provider: config.provider, error: err instanceof Error ? err.message : 'Invalid AI endpoint' }
    }

    const model = normalizeGeminiModel(config.model)
    const history = normalizeHistory(request.history)
    const workspaceSignal = normalizeWorkspaceSignal(request.workspaceSignal)
    const systemPrompt = buildSystemPrompt(request.context, request.intent)
    const fullInput = buildUserInput(history, workspaceSignal, prompt)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)

    try {
      if (config.provider === 'gemini') {
        if (!config.apiKey) {
          return { ok: false, provider: 'gemini', error: 'Gemini API key is required' }
        }
        const url = buildGeminiInteractionsUrl(endpointUrl)
        const res = await this.fetchImpl(url, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': config.apiKey,
            'Api-Revision': GEMINI_API_REVISION
          },
          body: JSON.stringify({
            model,
            system_instruction: systemPrompt,
            input: fullInput,
            store: false,
            response_format: {
              type: 'text',
              mime_type: 'application/json',
              schema: COMPANION_RESPONSE_SCHEMA
            }
          })
        })
        if (!res.ok) {
          await res.body?.cancel?.().catch(() => {})
          return { ok: false, provider: 'gemini', error: `Gemini API returned HTTP ${res.status}` }
        }
        const data = await readJsonWithLimit(res, MAX_AI_RESPONSE_BYTES, 'AI response exceeded size limit')
        const rawText = extractGeminiInteractionText(data)
        if (!rawText.trim()) {
          return { ok: false, provider: 'gemini', error: 'Empty response from Gemini API' }
        }
        return buildTextSuccessResult('gemini', rawText)
      }

      // Managed Ferry Pro Proxy (no company API keys ever shipped in the desktop binary)
      const base = endpointUrl.toString().replace(/\/+$/, '')
      const url = base.endsWith('/chat') ? base : `${base}/v1/companion/chat`
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`
      }
      const res = await this.fetchImpl(url, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers,
        body: JSON.stringify({
          model,
          intent: request.intent ?? 'chat',
          prompt,
          history,
          workspaceSignal,
          context: request.context,
          schema: COMPANION_RESPONSE_SCHEMA
        })
      })
      if (!res.ok) {
        await res.body?.cancel?.().catch(() => {})
        return { ok: false, provider: 'ferry-pro', error: `Ferry Pro AI returned HTTP ${res.status}` }
      }
      const data = (await readJsonWithLimit(res, MAX_AI_RESPONSE_BYTES, 'AI response exceeded size limit')) as Record<string, unknown>
      const directStructured = normalizeStructuredOutput(data?.structured)
      if (directStructured) {
        return {
          ok: true,
          provider: 'ferry-pro',
          text: directStructured.summary,
          structured: directStructured
        }
      }
      const rawText =
        (typeof data?.text === 'string' && data.text) ||
        extractGeminiInteractionText(data)
      if (!rawText.trim()) {
        return { ok: false, provider: 'ferry-pro', error: 'Empty response from Ferry Pro AI' }
      }
      return buildTextSuccessResult('ferry-pro', rawText)
    } catch (err) {
      return {
        ok: false,
        provider: config.provider,
        error: sanitizeErrorMessage(err, config.apiKey)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /** Lightweight connectivity check against the currently saved AI provider config. */
  async testConnection(): Promise<CompanionAiChatResult> {
    return this.chat({
      prompt: 'Reply with a JSON summary saying OK.',
      intent: 'chat',
      history: [],
      context: { appVersion: 'test', isConnected: false, theme: 'neutral' }
    })
  }
}
