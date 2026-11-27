import {
  DEFAULT_GEMINI_ENDPOINT,
  INVOKE_CHANNELS,
  normalizeGeminiModel,
  type CompanionAiCancelResult,
  type CompanionAiChatRequest,
  type CompanionAiChatResult,
  type CompanionAiConfigInfo,
  type CompanionAiIntent,
  type CompanionAiProvider,
  type CompanionReleasesResult,
  type CompanionSiteEnvironment,
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
const VALID_ENVIRONMENTS = new Set<CompanionSiteEnvironment>(['prod', 'staging', 'dev', 'other'])

function sanitizeSignalLine(val: unknown, maxLen: number): string | undefined {
  if (typeof val !== 'string') return undefined
  const trimmed = val.replace(/[\r\n]+/g, ' ').trim().slice(0, maxLen)
  return trimmed || undefined
}

function sanitizeSignalBlock(val: unknown, maxLen: number): string | undefined {
  if (typeof val !== 'string') return undefined
  const trimmed = val.trim().slice(0, maxLen)
  return trimmed || undefined
}

function sanitizeWorkspaceSignal(raw: unknown): CompanionWorkspaceSignal | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const obj = raw as Record<string, unknown>
  const out: CompanionWorkspaceSignal = {}
  const siteName = sanitizeSignalLine(obj.siteName, 120)
  if (siteName) out.siteName = siteName
  if (typeof obj.siteEnvironment === 'string' && VALID_ENVIRONMENTS.has(obj.siteEnvironment as CompanionSiteEnvironment)) {
    out.siteEnvironment = obj.siteEnvironment as CompanionSiteEnvironment
  }
  const remoteOs = sanitizeSignalLine(obj.remoteOs, 120)
  if (remoteOs) out.remoteOs = remoteOs
  const remoteShell = sanitizeSignalLine(obj.remoteShell, 80)
  if (remoteShell) out.remoteShell = remoteShell
  const remoteCwd = sanitizeSignalLine(obj.remoteCwd, 256)
  if (remoteCwd) out.remoteCwd = remoteCwd
  const terminalTail = sanitizeSignalBlock(obj.terminalTail, 2500)
  if (terminalTail) out.terminalTail = terminalTail
  const sftpSummary = sanitizeSignalBlock(obj.sftpSummary, 1000)
  if (sftpSummary) out.sftpSummary = sftpSummary
  const lastTransferError = sanitizeSignalBlock(obj.lastTransferError, 500)
  if (lastTransferError) out.lastTransferError = lastTransferError
  const logBasename = sanitizeSignalLine(obj.logBasename, 128)
  if (logBasename) out.logBasename = logBasename
  const logPath = sanitizeSignalLine(obj.logPath, 256)
  if (logPath) out.logPath = logPath
  const logSnippet = sanitizeSignalBlock(obj.logSnippet, 2500)
  if (logSnippet) out.logSnippet = logSnippet
  const monitorSummary = sanitizeSignalBlock(obj.monitorSummary, 1500)
  if (monitorSummary) out.monitorSummary = monitorSummary
  return Object.keys(out).length > 0 ? out : undefined
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

    const requestId = sanitizeSignalLine(req.requestId, 128)

    return AiCompanionService.getInstance().chat({
      requestId,
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

  handle<CompanionAiCancelResult>(INVOKE_CHANNELS.companionAiCancel, (payload: unknown) => {
    let requestId: string | undefined
    if (payload !== undefined && payload !== null) {
      const obj = requireObject(payload, INVOKE_CHANNELS.companionAiCancel)
      requestId = optionalString(obj.requestId, 'requestId', INVOKE_CHANNELS.companionAiCancel)?.trim() || undefined
    }
    return { cancelled: AiCompanionService.getInstance().cancel(requestId) }
  })
}
