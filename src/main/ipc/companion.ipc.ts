import {
  INVOKE_CHANNELS,
  type CompanionAiChatRequest,
  type CompanionAiChatResult,
  type CompanionAiConfigInfo,
  type CompanionAiConfigInput,
  type CompanionAiProvider,
  type CompanionReleasesResult
} from '../../shared/contract'
import { AppSettingsStore } from '../app/AppSettingsStore'
import { AiCompanionService, validateAiEndpoint } from '../companion/AiCompanionService'
import { ReleaseNotesService } from '../companion/ReleaseNotesService'
import { SshError } from '../ssh/errors'
import { handle } from './envelope'

const VALID_PROVIDERS = new Set<CompanionAiProvider>(['none', 'ollama', 'openai-compatible'])

/** Registers Ferry Companion sidecar channels (release notes & optional opt-in AI provider). */
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
    const endpoint = typeof raw?.endpoint === 'string' ? raw.endpoint.trim() : ''
    const model = typeof raw?.model === 'string' ? raw.model.trim() : ''
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

    return AiCompanionService.getInstance().chat({
      prompt: req.prompt,
      history: Array.isArray(req.history) ? req.history : [],
      context: {
        appVersion: safeSingleLine(req.context?.appVersion, 32),
        isConnected: Boolean(req.context?.isConnected),
        theme: safeSingleLine(req.context?.theme, 32)
      }
    })
  })
}
