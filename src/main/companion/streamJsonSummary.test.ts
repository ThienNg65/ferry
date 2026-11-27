import { describe, expect, it } from 'vitest'
import {
  consumeSseChunk,
  extractPartialSummaryField,
  flushSseCarry,
  parseGeminiSseEvent
} from './streamJsonSummary'
import { AiCompanionService } from './AiCompanionService'

describe('streamJsonSummary', () => {
  it('splits SSE frames cleanly across chunk boundaries and ignores [DONE]', () => {
    const state = { carry: '' }
    const first = consumeSseChunk(state, 'data: {"event_type":"step.delta","delta":{"type":"text","text":"hi"}}\n')
    expect(first).toEqual([])
    const second = consumeSseChunk(state, '\ndata: [DONE]\n\ndata: {"event_type":"interaction.completed"}')
    expect(second).toEqual(['{"event_type":"step.delta","delta":{"type":"text","text":"hi"}}'])
    expect(flushSseCarry(state)).toEqual(['{"event_type":"interaction.completed"}'])
  })

  it('extracts Gemini step.delta, content.delta, error, and completion events', () => {
    expect(
      parseGeminiSseEvent({ event_type: 'step.delta', delta: { type: 'text', text: 'abc' } })
    ).toEqual({ deltaText: 'abc' })
    expect(
      parseGeminiSseEvent({ event_type: 'content.delta', delta: { type: 'text', text: 'def' } })
    ).toEqual({ deltaText: 'def' })
    expect(
      parseGeminiSseEvent({ event_type: 'error', error: { message: 'rate limit' } })
    ).toEqual({ errorMessage: 'rate limit', done: true })
    expect(
      parseGeminiSseEvent({ event_type: 'interaction.completed', interaction: { output_text: '{}' } })
    ).toEqual({ completedInteraction: { output_text: '{}' }, done: true })
  })

  it('incrementally decodes partial JSON summary strings including split escapes', () => {
    expect(extractPartialSummaryField('{"sum')).toBeNull()
    expect(extractPartialSummaryField('{"summary": "CPU is high')).toBe('CPU is high')
    // Trailing backslash should wait without corrupting output
    expect(extractPartialSummaryField('{"summary": "Line 1\\')).toBe('Line 1')
    expect(extractPartialSummaryField('{"summary": "Line 1\\nLine \\"2\\" \\u0021"}')).toBe('Line 1\nLine "2" !')
  })

  it('streams real Gemini SSE events through AiCompanionService and emits clean summary deltas', async () => {
    const encoder = new TextEncoder()
    const chunks = [
      'data: {"event_type":"step.delta","delta":{"type":"text","text":"{\\"summary\\":\\"Disk is "}}\n\n',
      'data: {"event_type":"step.delta","delta":{"type":"text","text":"98% full on /var.\\",\\"commandCards\\":[{\\"command\\":\\"df -h\\",\\"description\\":\\"Check disk\\",\\"risk\\":\\"read_only\\"}]}"}}\n\n',
      'data: {"event_type":"interaction.completed","interaction":{"status":"completed"}}\n\n'
    ]
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) {
          controller.enqueue(encoder.encode(c))
        }
        controller.close()
      }
    })
    let capturedBody = ''
    const service = new AiCompanionService({
      fetchImpl: (async (_url, init) => {
        capturedBody = String(init?.body ?? '')
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' }
        })
      }) as typeof fetch,
      getConfig: () => ({
        provider: 'gemini',
        endpoint: 'https://generativelanguage.googleapis.com',
        model: 'gemini-4-hydrogen',
        hasApiKey: true,
        apiKey: 'AIzaTestKey123456789012345678901234'
      })
    })

    const streamed: string[] = []
    const res = await service.chat(
      {
        requestId: 'req-sse-1',
        prompt: 'Command to check disk',
        intent: 'command',
        context: { appVersion: '1.5.0', isConnected: true, theme: 'dark' }
      },
      undefined,
      { stream: true, onStreamSummary: (s) => streamed.push(s) }
    )

    expect(JSON.parse(capturedBody)).toMatchObject({
      stream: true,
      generation_config: { thinking_level: 'low' }
    })
    expect(res.ok).toBe(true)
    expect(res.structured?.summary).toBe('Disk is 98% full on /var.')
    expect(res.structured?.commandCards?.[0]?.command).toBe('df -h')
    expect(streamed.length).toBeGreaterThan(0)
    expect(streamed[streamed.length - 1]).toBe('Disk is 98% full on /var.')
  })
})
