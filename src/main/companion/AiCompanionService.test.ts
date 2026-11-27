import { describe, expect, it, vi } from 'vitest'
import {
  AiCompanionService,
  classifyCommandRisk,
  DEFAULT_GEMINI_ENDPOINT,
  DEFAULT_GEMINI_MODEL,
  parseStructuredCompanionResponse,
  validateAiEndpoint
} from './AiCompanionService'

describe('AiCompanionService', () => {
  it('enforces https for remote endpoints, defaults Gemini endpoint, and allows localhost proxy', () => {
    expect(validateAiEndpoint('gemini', '').toString()).toBe(`${DEFAULT_GEMINI_ENDPOINT}/`)
    expect(() => validateAiEndpoint('ferry-pro', 'http://localhost:8787')).not.toThrow()
    expect(() => validateAiEndpoint('ferry-pro', 'https://proxy.ferry.example')).not.toThrow()
    expect(() => validateAiEndpoint('ferry-pro', 'http://proxy.ferry.example')).toThrow(/https:\/\//)
    expect(() => validateAiEndpoint('gemini', 'https://user:secret@generativelanguage.googleapis.com')).toThrow()
  })

  it('refuses to call fetch when provider is disabled', async () => {
    const fetchImpl = vi.fn()
    const svc = new AiCompanionService({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getConfig: () => null
    })
    const res = await svc.chat({
      prompt: 'Hello',
      context: { appVersion: '1.3.1', isConnected: false, theme: 'dark' }
    })
    expect(res.ok).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('requires a Gemini API key when provider is gemini', async () => {
    const fetchImpl = vi.fn()
    const svc = new AiCompanionService({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getConfig: () => ({
        provider: 'gemini',
        endpoint: DEFAULT_GEMINI_ENDPOINT,
        model: DEFAULT_GEMINI_MODEL,
        hasApiKey: false
      })
    })
    const res = await svc.chat({
      prompt: 'Check disk space',
      context: { appVersion: '1.3.1', isConnected: true, theme: 'dark' }
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/API key/i)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('calls Gemini v1beta/interactions with store=false, schema, and parses structured Command & UI Action Cards', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        output_text: JSON.stringify({
          summary: 'Disk space is nearly full on /var/log.',
          rootCause: 'Rotated nginx logs filled the volume.',
          commandCards: [
            { command: 'df -h', description: 'Check disk usage', risk: 'read_only' },
            { command: 'rm -rf /var/log/old-cache', description: 'Delete stale cache', risk: 'read_only' }
          ],
          uiActionCards: [
            { kind: 'tail-log', remotePath: '/var/log/nginx/error.log', label: 'Tail error.log' }
          ]
        })
      })
    })

    const svc = new AiCompanionService({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getConfig: () => ({
        provider: 'gemini',
        endpoint: DEFAULT_GEMINI_ENDPOINT,
        model: 'gemini-2.5-flash',
        hasApiKey: true,
        apiKey: 'AIza-test-key'
      })
    })

    const res = await svc.chat({
      prompt: 'Explain why disk is full',
      intent: 'explain-log',
      workspaceSignal: { logPath: '/var/log/nginx/error.log', logSnippet: 'ENOSPC: no space left on device' },
      context: { appVersion: '1.3.1', isConnected: true, theme: 'dark' }
    })

    expect(res.ok).toBe(true)
    expect(res.provider).toBe('gemini')
    expect(res.text).toBe('Disk space is nearly full on /var/log.')
    expect(res.structured?.rootCause).toBe('Rotated nginx logs filled the volume.')
    expect(res.structured?.commandCards).toEqual([
      { command: 'df -h', description: 'Check disk usage', risk: 'read_only' },
      // Deterministic safety floor prevents destructive commands from being labeled read_only
      { command: 'rm -rf /var/log/old-cache', description: 'Delete stale cache', risk: 'destructive' }
    ])
    expect(res.structured?.uiActionCards).toEqual([
      { kind: 'tail-log', remotePath: '/var/log/nginx/error.log', label: 'Tail error.log' }
    ])

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
    expect(init.redirect).toBe('error')
    expect(init.headers['x-goog-api-key']).toBe('AIza-test-key')
    expect(init.headers['Api-Revision']).toBe('2026-05-20')
    const sentBody = JSON.parse(init.body)
    expect(sentBody.model).toBe('gemini-4-hydrogen')
    expect(sentBody.store).toBe(false)
    expect(sentBody.response_format.mime_type).toBe('application/json')

    const ping = await svc.testConnection()
    expect(ping.ok).toBe(true)
  })

  it('reuses the saved key when testing an unsaved config only for the same provider', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 })
    const svc = new AiCompanionService({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getConfig: () => ({
        provider: 'gemini',
        endpoint: DEFAULT_GEMINI_ENDPOINT,
        model: DEFAULT_GEMINI_MODEL,
        hasApiKey: true,
        apiKey: 'AIza-saved-key'
      })
    })

    await svc.testConnection({ provider: 'ferry-pro', endpoint: 'https://proxy.ferry.example', model: DEFAULT_GEMINI_MODEL })
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain('AIza-saved-key')

    await svc.testConnection({ provider: 'gemini', endpoint: DEFAULT_GEMINI_ENDPOINT, model: DEFAULT_GEMINI_MODEL })
    expect(fetchImpl.mock.calls.at(-1)?.[1].headers['x-goog-api-key']).toBe('AIza-saved-key')
  })

  it('calls Managed Ferry Pro proxy with Bearer token and strips secrets on error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 })
    const svc = new AiCompanionService({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getConfig: () => ({
        provider: 'ferry-pro',
        endpoint: 'https://proxy.ferry.example',
        model: DEFAULT_GEMINI_MODEL,
        hasApiKey: true,
        apiKey: 'ferry-pro-secret'
      })
    })
    const res = await svc.chat({
      prompt: 'Diagnose CPU spike',
      intent: 'diagnose-spike',
      context: { appVersion: '1.3.1', isConnected: true, theme: 'dark' }
    })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('429')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://proxy.ferry.example/v1/companion/chat',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: expect.objectContaining({ Authorization: 'Bearer ferry-pro-secret' })
      })
    )

    const svcLeak = new AiCompanionService({
      fetchImpl: vi.fn().mockRejectedValue(new Error('Failed with AIza-secret-token')) as unknown as typeof fetch,
      getConfig: () => ({
        provider: 'gemini',
        endpoint: DEFAULT_GEMINI_ENDPOINT,
        model: DEFAULT_GEMINI_MODEL,
        hasApiKey: true,
        apiKey: 'AIza-secret-token'
      })
    })
    const leakRes = await svcLeak.chat({
      prompt: 'Hello',
      history: [null as unknown as { role: 'user'; text: string }],
      context: { appVersion: '1.3.1', isConnected: false, theme: 'light' }
    })
    expect(leakRes.ok).toBe(false)
    expect(leakRes.error).not.toContain('AIza-secret-token')
  })

  it('classifies command risks and handles fenced or plain-text responses safely', () => {
    expect(classifyCommandRisk('df -h')).toBe('read_only')
    expect(classifyCommandRisk('systemctl restart nginx')).toBe('mutating')
    expect(classifyCommandRisk('rm -rf /tmp/build')).toBe('destructive')

    const parsedFenced = parseStructuredCompanionResponse('```json\n{"summary":"All good"}\n```')
    expect(parsedFenced).toEqual({ summary: 'All good' })

    const parsedPlain = parseStructuredCompanionResponse('Plain fallback text')
    expect(parsedPlain).toEqual({ summary: 'Plain fallback text' })
  })

  it('avoids duplicating /v1beta in Gemini endpoint and bounds history sent to Ferry Pro proxy', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ output_text: JSON.stringify({ summary: 'Ok' }) })
    })
    const geminiSvc = new AiCompanionService({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getConfig: () => ({
        provider: 'gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta',
        model: DEFAULT_GEMINI_MODEL,
        hasApiKey: true,
        apiKey: 'AIza-key'
      })
    })
    await geminiSvc.chat({
      prompt: 'Ping',
      context: { appVersion: '1.4.0', isConnected: false, theme: 'dark' }
    })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')

    const proFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ structured: { summary: 'Pro ok' } })
    })
    const proSvc = new AiCompanionService({
      fetchImpl: proFetch as unknown as typeof fetch,
      getConfig: () => ({
        provider: 'ferry-pro',
        endpoint: 'https://proxy.ferry.example',
        model: DEFAULT_GEMINI_MODEL,
        hasApiKey: true,
        apiKey: 'ferry_pro_key'
      })
    })
    await proSvc.chat({
      prompt: 'Ping',
      history: Array.from({ length: 20 }, (_, i) => ({ role: 'user' as const, text: `turn-${i}-` + 'X'.repeat(2000) })),
      context: { appVersion: '1.4.0', isConnected: true, theme: 'dark' }
    })
    const sent = JSON.parse(proFetch.mock.calls[0][1].body)
    expect(sent.history).toHaveLength(6)
    expect(sent.history[0].text.length).toBe(1000)
  })
})
