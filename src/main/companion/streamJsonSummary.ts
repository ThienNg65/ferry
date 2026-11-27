/**
 * Pure incremental SSE + partial JSON "summary" extractor for Gemini Interactions streaming.
 *
 * Because Ferry Companion requests `response_format: { type: 'text', mime_type: 'application/json', schema }`,
 * streamed `step.delta` text chunks contain incremental JSON (`{"summary":"...`). This module decodes
 * the `"summary"` string incrementally as tokens arrive so the UI streams clean prose rather than raw JSON.
 */

export interface SseFrameState {
  carry: string
}

/** Splits an incoming UTF-8 SSE chunk into complete `data:` payload strings, preserving partial lines across chunks. */
export function consumeSseChunk(state: SseFrameState, chunk: string): string[] {
  const combined = state.carry + chunk.replace(/\r\n/g, '\n')
  const blocks = combined.split('\n\n')
  state.carry = blocks.pop() ?? ''

  const payloads: string[] = []
  for (const block of blocks) {
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
    }
    if (dataLines.length > 0) {
      const payload = dataLines.join('\n').trim()
      if (payload && payload !== '[DONE]') {
        payloads.push(payload)
      }
    }
  }
  return payloads
}

/** Flushes any trailing buffered SSE frame at EOF. */
export function flushSseCarry(state: SseFrameState): string[] {
  if (!state.carry.trim()) {
    state.carry = ''
    return []
  }
  return consumeSseChunk(state, '\n\n')
}

export interface ParsedSseDelta {
  deltaText?: string
  completedInteraction?: unknown
  errorMessage?: string
  done?: boolean
}

/** Extracts text deltas, completion, or errors from a parsed Gemini Interactions SSE JSON event. */
export function parseGeminiSseEvent(event: unknown): ParsedSseDelta {
  if (!event || typeof event !== 'object') return {}
  const rec = event as Record<string, unknown>
  const eventType = typeof rec.event_type === 'string' ? rec.event_type : ''

  if (eventType === 'error') {
    const errObj = rec.error && typeof rec.error === 'object' ? (rec.error as Record<string, unknown>) : null
    const message = typeof errObj?.message === 'string' ? errObj.message : 'Streaming error from AI provider'
    return { errorMessage: message, done: true }
  }

  if (eventType === 'step.delta' || eventType === 'content.delta') {
    const delta = rec.delta && typeof rec.delta === 'object' ? (rec.delta as Record<string, unknown>) : null
    if (delta && delta.type === 'text' && typeof delta.text === 'string') {
      return { deltaText: delta.text }
    }
    return {}
  }

  if (eventType === 'interaction.completed' || eventType === 'interaction.complete') {
    return { completedInteraction: rec.interaction, done: true }
  }

  // Fallback for proxies that emit `{ delta: "..." }` or `{ text: "..." }`
  if (typeof rec.delta === 'string') {
    return { deltaText: rec.delta }
  }
  return {}
}

/**
 * Incrementally extracts and unescapes the `"summary"` JSON string value from a partial JSON buffer.
 * Returns `null` until `"summary": "` has appeared; handles split escape sequences safely without throwing.
 */
export function extractPartialSummaryField(rawJsonBuffer: string): string | null {
  const keyMatch = /"summary"\s*:\s*"/.exec(rawJsonBuffer)
  if (!keyMatch) return null

  let i = keyMatch.index + keyMatch[0].length
  let out = ''
  const len = rawJsonBuffer.length

  while (i < len) {
    const ch = rawJsonBuffer[i]
    if (ch === '"') {
      // Complete summary string reached.
      return out
    }
    if (ch === '\\') {
      if (i + 1 >= len) {
        // Incomplete escape at end of buffer — wait for next chunk.
        break
      }
      const next = rawJsonBuffer[i + 1]
      if (next === 'n') {
        out += '\n'
        i += 2
      } else if (next === 'r') {
        out += '\r'
        i += 2
      } else if (next === 't') {
        out += '\t'
        i += 2
      } else if (next === '"' || next === '\\' || next === '/') {
        out += next
        i += 2
      } else if (next === 'b') {
        out += '\b'
        i += 2
      } else if (next === 'f') {
        out += '\f'
        i += 2
      } else if (next === 'u') {
        if (i + 6 > len) {
          // Incomplete \uXXXX sequence — wait for next chunk.
          break
        }
        const hex = rawJsonBuffer.slice(i + 2, i + 6)
        const code = Number.parseInt(hex, 16)
        if (Number.isFinite(code)) {
          out += String.fromCharCode(code)
        }
        i += 6
      } else {
        out += next
        i += 2
      }
      continue
    }
    out += ch
    i += 1
  }

  return out
}
