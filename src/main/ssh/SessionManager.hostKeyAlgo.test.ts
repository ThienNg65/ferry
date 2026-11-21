import { describe, expect, it } from 'vitest'
import { extractHostKeyAlgorithm } from './SessionManager'

describe('extractHostKeyAlgorithm', () => {
  it('parses length-prefixed SSH wire algorithm name and rejects malformed buffers', () => {
    const algo = Buffer.from('ssh-ed25519', 'ascii')
    const wire = Buffer.alloc(4 + algo.length + 8)
    wire.writeUInt32BE(algo.length, 0)
    algo.copy(wire, 4)
    expect(extractHostKeyAlgorithm(wire)).toBe('ssh-ed25519')
    expect(extractHostKeyAlgorithm(Buffer.from([0, 0, 0, 99]))).toBeUndefined()
    expect(extractHostKeyAlgorithm('not-a-buffer')).toBeUndefined()
  })
})
