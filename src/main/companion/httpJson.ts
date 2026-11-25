/**
 * Reads and parses a JSON HTTP response while enforcing a hard byte cap across
 * both `Content-Length` headers and chunked streaming bodies.
 */
export async function readJsonWithLimit(res: Response, maxBytes: number, limitErrorMessage: string): Promise<unknown> {
  const contentLength = Number(res.headers?.get?.('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await res.body?.cancel?.().catch(() => {})
    throw new Error(limitErrorMessage)
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    return res.json()
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
        throw new Error(limitErrorMessage)
      }
      chunks.push(value)
    }
  }
  const merged = Buffer.concat(chunks)
  return JSON.parse(merged.toString('utf8'))
}
