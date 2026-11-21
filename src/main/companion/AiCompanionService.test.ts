import { describe, expect, it, vi } from 'vitest'
import { AiCompanionService, validateAiEndpoint } from './AiCompanionService'

describe('AiCompanionService', () => {
  it('enforces https for remote endpoints and allows loopback http for local providers', () => {
    expect(() => validateAiEndpoint('ollama', 'http://localhost:11434')).not.toThrow()
    expect(() => validateAiEndpoint('openai-compatible', 'https://api.openai.com/v1')).not.toThrow()
    expect(() => validateAiEndpoint('openai-compatible', 'http://api.openai.com/v1')).toThrow(/https:\/\//)
    expect(() => validateAiEndpoint('ollama', 'http://192.168.1.50:11434')).toThrow(/localhost/)
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

  it('calls local Ollama /api/chat and returns reply text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: 'Try checking file permissions first.' } })
    })
    const svc = new AiCompanionService({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getConfig: () => ({
        provider: 'ollama',
        endpoint: 'http://localhost:11434',
        model: 'llama3.2',
        hasApiKey: false
      })
    })
    const res = await svc.chat({
      prompt: 'Why did upload fail?',
      context: { appVersion: '1.3.1', isConnected: true, theme: 'dark' }
    })
    expect(res).toEqual({
      ok: true,
      provider: 'ollama',
      text: 'Try checking file permissions first.'
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.objectContaining({ method: 'POST', redirect: 'error' })
    )

    const ping = await svc.testConnection()
    expect(ping.ok).toBe(true)
  })

  it('sends Bearer token to openai-compatible endpoint and fails gracefully on HTTP error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 429
    })
    const svc = new AiCompanionService({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getConfig: () => ({
        provider: 'openai-compatible',
        endpoint: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        hasApiKey: true,
        apiKey: 'sk-secret-key'
      })
    })
    const res = await svc.chat({
      prompt: 'Help me',
      context: { appVersion: '1.3.1', isConnected: false, theme: 'light' }
    })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('429')
  })

  it('rejects endpoint URLs with embedded credentials, handles malformed history/decrypt errors, and strips apiKey from error messages', async () => {
    expect(() => validateAiEndpoint('openai-compatible', 'https://user:secret@api.example.com/v1')).toThrow()

    const svcThrowDecrypt = new AiCompanionService({
      getConfig: () => {
        throw new Error('keychain locked')
      }
    })
    const decryptRes = await svcThrowDecrypt.chat({
      prompt: 'Hello',
      context: { appVersion: '1.3.1', isConnected: false, theme: 'light' }
    })
    expect(decryptRes.ok).toBe(false)
    expect(decryptRes.error).toContain('keychain locked')

    const svcLeak = new AiCompanionService({
      fetchImpl: vi.fn().mockRejectedValue(new Error('Failed with sk-top-secret-key')) as unknown as typeof fetch,
      getConfig: () => ({
        provider: 'openai-compatible',
        endpoint: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        hasApiKey: true,
        apiKey: 'sk-top-secret-key'
      })
    })
    const leakRes = await svcLeak.chat({
      prompt: 'Hello',
      history: [null as unknown as { role: 'user'; text: string }],
      context: { appVersion: '1.3.1', isConnected: false, theme: 'light' }
    })
    expect(leakRes.ok).toBe(false)
    expect(leakRes.error).not.toContain('sk-top-secret-key')
  })
})
