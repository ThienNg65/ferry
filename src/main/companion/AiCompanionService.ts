import type {
  CompanionAiChatRequest,
  CompanionAiChatResult,
  CompanionAiProvider
} from '../../shared/contract'
import { AppSettingsStore } from '../app/AppSettingsStore'

const AI_TIMEOUT_MS = 15_000
const MAX_HISTORY_TURNS = 6
const MAX_PROMPT_CHARS = 2_000
const MAX_REPLY_CHARS = 4_000
const MAX_AI_RESPONSE_BYTES = 256 * 1024

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

async function readJsonWithLimit(res: Response, maxBytes: number): Promise<unknown> {
  const contentLength = Number(res.headers?.get?.('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('AI response exceeded size limit')
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    const data = await res.json()
    return data
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new Error('AI response exceeded size limit')
      }
      chunks.push(value)
    }
  }
  const merged = Buffer.concat(chunks)
  return JSON.parse(merged.toString('utf8'))
}

export function validateAiEndpoint(provider: CompanionAiProvider, rawEndpoint: string): URL {
  const trimmed = rawEndpoint.trim()
  if (!trimmed) {
    throw new Error('AI endpoint URL is required')
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
  throw new Error(
    provider === 'ollama'
      ? 'Ollama endpoint must use http://localhost (loopback) or https://'
      : 'Remote AI endpoints must use https:// (http:// is allowed only for localhost)'
  )
}

function buildSystemPrompt(ctx: CompanionAiChatRequest['context']): string {
  return [
    'You are Ferry Companion, a concise, friendly desktop assistant inside Ferry (an SFTP/SSH client with live remote log tailing).',
    `Current app context (non-sensitive): Ferry v${ctx.appVersion || 'unknown'}, connected=${ctx.isConnected ? 'yes' : 'no'}, theme=${ctx.theme || 'unknown'}.`,
    'Rules:',
    '- Be brief, practical, and trustworthy (under 140 words unless steps are needed).',
    '- Never claim you executed a command, modified a file, or accessed a remote server.',
    '- Only suggest non-destructive steps the user can perform themselves in Ferry.',
    '- Never ask for passwords, private keys, or secrets.'
  ].join('\n')
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
      return { ok: false, error: 'Optional AI provider is disabled' }
    }

    const prompt = request.prompt.trim().slice(0, MAX_PROMPT_CHARS)
    if (!prompt) {
      return { ok: false, error: 'Prompt is empty' }
    }

    let endpointUrl: URL
    try {
      endpointUrl = validateAiEndpoint(config.provider, config.endpoint)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Invalid AI endpoint' }
    }

    const model = config.model.trim()
    if (!model) {
      return { ok: false, error: 'AI model name is required' }
    }

    const history = (request.history ?? [])
      .slice(-MAX_HISTORY_TURNS)
      .filter(
        (m): m is { role: 'user' | 'assistant'; text: string } =>
          Boolean(m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
      )
      .map((m) => ({ role: m.role, content: m.text.trim().slice(0, 1000) }))

    const messages = [
      { role: 'system', content: buildSystemPrompt(request.context) },
      ...history,
      { role: 'user', content: prompt }
    ]

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)

    try {
      if (config.provider === 'ollama') {
        const base = endpointUrl.toString().replace(/\/+$/, '')
        const url = base.endsWith('/api/chat') ? base : `${base}/api/chat`
        const res = await this.fetchImpl(url, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, stream: false })
        })
        if (!res.ok) {
          return { ok: false, provider: 'ollama', error: `Ollama returned HTTP ${res.status}` }
        }
        const data = (await readJsonWithLimit(res, MAX_AI_RESPONSE_BYTES)) as { message?: { content?: unknown } }
        const text =
          typeof data?.message?.content === 'string'
            ? data.message.content.trim().slice(0, MAX_REPLY_CHARS)
            : ''
        if (!text) {
          return { ok: false, provider: 'ollama', error: 'Empty response from Ollama' }
        }
        return { ok: true, provider: 'ollama', text }
      }

      // openai-compatible
      const base = endpointUrl.toString().replace(/\/+$/, '')
      const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`
      }
      const res = await this.fetchImpl(url, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers,
        body: JSON.stringify({ model, messages, max_tokens: 450, temperature: 0.3 })
      })
      if (!res.ok) {
        return { ok: false, provider: 'openai-compatible', error: `AI provider returned HTTP ${res.status}` }
      }
      const data = (await readJsonWithLimit(res, MAX_AI_RESPONSE_BYTES)) as {
        choices?: Array<{ message?: { content?: unknown } }>
      }
      const text =
        typeof data?.choices?.[0]?.message?.content === 'string'
          ? data.choices[0].message.content.trim().slice(0, MAX_REPLY_CHARS)
          : ''
      if (!text) {
        return { ok: false, provider: 'openai-compatible', error: 'Empty response from AI provider' }
      }
      return { ok: true, provider: 'openai-compatible', text }
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
      prompt: 'Reply with OK in one word.',
      history: [],
      context: { appVersion: 'test', isConnected: false, theme: 'neutral' }
    })
  }
}
