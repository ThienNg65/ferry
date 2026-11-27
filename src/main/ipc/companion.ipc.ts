import {
  DEFAULT_GEMINI_ENDPOINT,
  INVOKE_CHANNELS,
  normalizeGeminiModel,
  type CompanionAiChatRequest,
  type CompanionAiChatResult,
  type CompanionAiConfigInfo,
  type CompanionAiIntent,
  type CompanionAiProvider,
  type CompanionReleasesResult,
  type CompanionWorkspaceSignal
} from '../../shared/contract'
import { AppSettingsStore } from '../app/AppSettingsStore'
import { AiCompanionService, validateAiEndpoint } from '../companion/AiCompanionService'
import { ReleaseNotesService } from '../companion/ReleaseNotesService'
import { handle } from './envelope'
import {
  failValidation,
  optionalBoolean,
  optionalSecretString,
  optionalString,
  requireEnum,
  requireNonEmptyString,
  requireObject
} from './validation'

const VALID_PROVIDERS: readonly CompanionAiProvider[] = ['none', 'gemini', 'ferry-pro']
const VALID_INTENTS = new Set<CompanionAiIntent>(['chat', 'command', 'explain-log', 'diagnose-spike'])

function sanitizeWorkspaceSignal(raw: unknown): CompanionWorkspaceSignal | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const obj = raw as Record<string, unknown>
  const out: CompanionWorkspaceSignal = {}
  if (typeof obj.logPath === 'string' && obj.logPath.trim()) {
    out.logPath = obj.logPath.replace(/[\r\n]+/g, ' ').trim().slice(0, 256)
  }
  if (typeof obj.logSnippet === 'string' && obj.logSnippet.trim()) {
    out.logSnippet = obj.logSnippet.trim().slice(0, 2500)
  }
  if (typeof obj.monitorSummary === 'string' && obj.monitorSummary.trim()) {
    out.monitorSummary = obj.monitorSummary.trim().slice(0, 1500)
  }
  return out.logPath || out.logSnippet || out.monitorSummary ? out : undefined
}

function sanitizeHistory(raw: unknown): CompanionAiChatRequest['history'] {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(-6)
    .filter(
      (m): m is { role: 'user' | 'assistant'; text: string } =>
        Boolean(
          m &&
            typeof m === 'object' &&
            ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant') &&
            typeof (m as { text?: unknown }).text === 'string' &&
            (m as { text: string }).text.trim()
        )
    )
    .map((m) => ({ role: m.role, text: m.text.trim().slice(0, 1000) }))
}

function parseAiConfigPayload(
  payload: unknown,
  channel: string
): { provider: CompanionAiProvider; endpoint: string; model: string; apiKey: string | undefined } {
  const obj = requireObject(payload, channel)
  const provider = requireEnum(obj.provider, VALID_PROVIDERS, 'provider', channel)
  const rawEndpoint = optionalString(obj.endpoint, 'endpoint', channel)?.trim() ?? ''
  const endpoint = rawEndpoint || (provider === 'gemini' ? DEFAULT_GEMINI_ENDPOINT : '')
  const rawModel = optionalString(obj.model, 'model', channel)?.trim() ?? ''
  const model = provider === 'none' ? '' : normalizeGeminiModel(rawModel)
  if (provider !== 'none') {
    try {
      validateAiEndpoint(provider, endpoint)
    } catch (err) {
      failValidation(channel, err instanceof Error ? err.message : 'Invalid AI endpoint')
    }
    if (!model || model.length > 120) {
      failValidation(channel, `${channel} requires a model name (<= 120 chars)`)
    }
    if (endpoint.length > 512) {
      failValidation(channel, `${channel} endpoint exceeds 512 chars`)
    }
  }
  const apiKey = optionalSecretString(obj.apiKey, 'apiKey', channel)
  return { provider, endpoint, model, apiKey }
}

/** Registers Ferry Companion sidecar channels (release notes & Gemini/Pro AI provider). */
export function registerCompanionHandlers(): void {
  handle<CompanionReleasesResult>(INVOKE_CHANNELS.companionGetReleases, async (payload: unknown) => {
    let forceRefresh = false
    if (payload !== undefined && payload !== null) {
      const obj = requireObject(payload, INVOKE_CHANNELS.companionGetReleases)
      forceRefresh = optionalBoolean(obj.forceRefresh, 'forceRefresh', INVOKE_CHANNELS.companionGetReleases) ?? false
    }
    return ReleaseNotesService.getInstance().getReleases(forceRefresh)
  })

  handle<CompanionAiConfigInfo>(INVOKE_CHANNELS.companionAiGetConfig, () => {
    return AppSettingsStore.getInstance().getCompanionAiConfig()
  })

  handle<CompanionAiConfigInfo>(INVOKE_CHANNELS.companionAiSetConfig, (payload: unknown) => {
    const cfg = parseAiConfigPayload(payload, INVOKE_CHANNELS.companionAiSetConfig)
    return AppSettingsStore.getInstance().setCompanionAiConfig(cfg)
  })

  handle<CompanionAiChatResult>(INVOKE_CHANNELS.companionAiTest, async (payload: unknown) => {
    if (payload !== undefined && payload !== null) {
      const cfg = parseAiConfigPayload(payload, INVOKE_CHANNELS.companionAiTest)
      return AiCompanionService.getInstance().testConnection(cfg)
    }
    return AiCompanionService.getInstance().testConnection()
  })

  handle<CompanionAiChatResult>(INVOKE_CHANNELS.companionAiChat, async (payload: unknown) => {
    const req = requireObject(payload, INVOKE_CHANNELS.companionAiChat)
    const prompt = requireNonEmptyString(req.prompt, 'prompt', INVOKE_CHANNELS.companionAiChat)
    const safeSingleLine = (val: unknown, maxLen: number): string =>
      typeof val === 'string' ? val.replace(/[\r\n]+/g, ' ').trim().slice(0, maxLen) : 'unknown'

    const rawIntent = req.intent
    const intent =
      typeof rawIntent === 'string' && VALID_INTENTS.has(rawIntent as CompanionAiIntent)
        ? (rawIntent as CompanionAiIntent)
        : undefined
    const ctx = req.context && typeof req.context === 'object' && !Array.isArray(req.context)
      ? (req.context as Record<string, unknown>)
      : undefined

    return AiCompanionService.getInstance().chat({
      prompt,
      history: sanitizeHistory(req.history),
      intent,
      workspaceSignal: sanitizeWorkspaceSignal(req.workspaceSignal),
      context: {
        appVersion: safeSingleLine(ctx?.appVersion, 32),
        isConnected: Boolean(ctx?.isConnected),
        theme: safeSingleLine(ctx?.theme, 32)
      }
    })
  })
}
