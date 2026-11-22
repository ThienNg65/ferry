import {
  DEFAULT_GEMINI_ENDPOINT,
  INVOKE_CHANNELS,
  normalizeGeminiModel,
  type CompanionAiChatRequest,
  type CompanionAiChatResult,
  type CompanionAiConfigInfo,
  type CompanionAiConfigInput,
  type CompanionAiIntent,
  type CompanionAiProvider,
  type CompanionReleasesResult,
  type CompanionWorkspaceSignal
} from '../../shared/contract'
import { AppSettingsStore } from '../app/AppSettingsStore'
import { AiCompanionService, validateAiEndpoint } from '../companion/AiCompanionService'
import { ReleaseNotesService } from '../companion/ReleaseNotesService'
import { SshError } from '../ssh/errors'
import { handle } from './envelope'

const VALID_PROVIDERS = new Set<CompanionAiProvider>(['none', 'gemini', 'ferry-pro'])
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

/** Registers Ferry Companion sidecar channels (release notes & Gemini/Pro AI provider). */
export function registerCompanionHandlers(): void {
  handle<CompanionReleasesResult>(INVOKE_CHANNELS.companionGetReleases, async (payload: unknown) => {
    const forceRefresh = Boolean(
      payload && typeof payload === 'object' && (payload as { forceRefresh?: unknown }).forceRefresh === true
    )
    return ReleaseNotesService.getInstance().getReleases(forceRefresh)
  })

  handle<CompanionAiConfigInfo>(INVOKE_CHANNELS.companionAiGetConfig, () => {
    return AppSettingsStore.getInstance().getCompanionAiConfig()
  })

  handle<CompanionAiConfigInfo>(INVOKE_CHANNELS.companionAiSetConfig, (payload: unknown) => {
    const raw = payload as Partial<CompanionAiConfigInput> | null | undefined
    const provider = raw?.provider
    if (!provider || !VALID_PROVIDERS.has(provider)) {
      throw new SshError('VALIDATION', 'companion:ai:setConfig requires a valid provider')
    }
    const rawEndpoint = typeof raw?.endpoint === 'string' ? raw.endpoint.trim() : ''
    const endpoint = rawEndpoint || (provider === 'gemini' ? DEFAULT_GEMINI_ENDPOINT : '')
    const rawModel = typeof raw?.model === 'string' ? raw.model.trim() : ''
    const model = provider === 'none' ? '' : normalizeGeminiModel(rawModel)
    if (provider !== 'none') {
      try {
        validateAiEndpoint(provider, endpoint)
      } catch (err) {
        throw new SshError('VALIDATION', err instanceof Error ? err.message : 'Invalid AI endpoint')
      }
      if (!model || model.length > 120) {
        throw new SshError('VALIDATION', 'companion:ai:setConfig requires a model name (<= 120 chars)')
      }
      if (endpoint.length > 512) {
        throw new SshError('VALIDATION', 'companion:ai:setConfig endpoint exceeds 512 chars')
      }
    }
    if (raw?.apiKey !== undefined && typeof raw.apiKey !== 'string') {
      throw new SshError('VALIDATION', 'companion:ai:setConfig apiKey must be a string')
    }
    const apiKey = raw?.apiKey
    return AppSettingsStore.getInstance().setCompanionAiConfig({ provider, endpoint, model, apiKey })
  })

  handle<CompanionAiChatResult>(INVOKE_CHANNELS.companionAiTest, async () => {
    return AiCompanionService.getInstance().testConnection()
  })

  handle<CompanionAiChatResult>(INVOKE_CHANNELS.companionAiChat, async (payload: unknown) => {
    const req = payload as Partial<CompanionAiChatRequest> | null | undefined
    if (!req || typeof req.prompt !== 'string' || !req.prompt.trim()) {
      throw new SshError('VALIDATION', 'companion:ai:chat requires a non-empty prompt')
    }
    const safeSingleLine = (val: unknown, maxLen: number): string =>
      typeof val === 'string' ? val.replace(/[\r\n]+/g, ' ').trim().slice(0, maxLen) : 'unknown'

    const intent = req.intent && VALID_INTENTS.has(req.intent) ? req.intent : undefined

    return AiCompanionService.getInstance().chat({
      prompt: req.prompt,
      history: Array.isArray(req.history) ? req.history : [],
      intent,
      workspaceSignal: sanitizeWorkspaceSignal(req.workspaceSignal),
      context: {
        appVersion: safeSingleLine(req.context?.appVersion, 32),
        isConnected: Boolean(req.context?.isConnected),
        theme: safeSingleLine(req.context?.theme, 32)
      }
    })
  })
}
