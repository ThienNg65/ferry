import { describe, expect, it, vi } from 'vitest'
import {
  computeLineDiff,
  diffLocalAndRemote,
  isBinaryBuffer,
  MAX_DIFF_BYTES,
  splitNormalizedLines
} from './FileDiffService'

describe('FileDiffService', () => {
  describe('isBinaryBuffer', () => {
    it('treats empty and valid UTF-8 text buffers as text', () => {
      expect(isBinaryBuffer(Buffer.alloc(0))).toBe(false)
      expect(isBinaryBuffer(Buffer.from('hello world\nline 2\tindented\n', 'utf-8'))).toBe(false)
      expect(isBinaryBuffer(Buffer.from('Tiếng Việt UTF-8 — café 🚀\n', 'utf-8'))).toBe(false)
    })

    it('detects NUL bytes and high control-character density as binary', () => {
      expect(isBinaryBuffer(Buffer.from([0x61, 0x62, 0x00, 0x63]))).toBe(true)
      const binaryControl = Buffer.alloc(100, 0x03)
      expect(isBinaryBuffer(binaryControl)).toBe(true)
    })
  })

  describe('splitNormalizedLines & computeLineDiff', () => {
    it('normalizes CRLF and LF line endings as identical', () => {
      expect(splitNormalizedLines('a\r\nb\r\n')).toEqual(['a', 'b'])
      const diff = computeLineDiff('alpha\r\nbeta\r\ngamma\r\n', 'alpha\nbeta\ngamma\n')
      expect(diff).toEqual({ identical: true, additions: 0, deletions: 0, hunks: [] })
    })

    it('computes additions, deletions, and replacements with surrounding context', () => {
      const local = ['one', 'two', 'three', 'four', 'five', 'six'].join('\n')
      const remote = ['one', 'two', 'THREE', 'four', 'five', 'six', 'seven'].join('\n')
      const diff = computeLineDiff(local, remote)

      expect(diff.identical).toBe(false)
      expect(diff.additions).toBe(2)
      expect(diff.deletions).toBe(1)
      expect(diff.hunks).toHaveLength(1)
      expect(diff.hunks[0].lines).toEqual([
        { kind: 'context', text: 'one', localLine: 1, remoteLine: 1 },
        { kind: 'context', text: 'two', localLine: 2, remoteLine: 2 },
        { kind: 'remove', text: 'three', localLine: 3, remoteLine: null },
        { kind: 'add', text: 'THREE', localLine: null, remoteLine: 3 },
        { kind: 'context', text: 'four', localLine: 4, remoteLine: 4 },
        { kind: 'context', text: 'five', localLine: 5, remoteLine: 5 },
        { kind: 'context', text: 'six', localLine: 6, remoteLine: 6 },
        { kind: 'add', text: 'seven', localLine: null, remoteLine: 7 }
      ])
    })

    it('separates distant changes into distinct hunks', () => {
      const linesA = Array.from({ length: 20 }, (_, i) => `line-${i + 1}`)
      const linesB = [...linesA]
      linesB[0] = 'line-1-edited'
      linesB[19] = 'line-20-edited'

      const diff = computeLineDiff(linesA.join('\n'), linesB.join('\n'), 2)
      expect(diff.hunks).toHaveLength(2)
      expect(diff.hunks[0].localStart).toBe(1)
      expect(diff.hunks[1].localStart).toBe(18)
    })

    it('handles empty vs non-empty files', () => {
      const added = computeLineDiff('', 'a\nb\n')
      expect(added.identical).toBe(false)
      expect(added.additions).toBe(2)
      expect(added.deletions).toBe(0)

      const removed = computeLineDiff('a\nb\n', '')
      expect(removed.identical).toBe(false)
      expect(removed.additions).toBe(0)
      expect(removed.deletions).toBe(2)
    })

    it('falls back to a simplified diff when Myers edit distance exceeds cap', () => {
      const local = Array.from({ length: 900 }, (_, i) => `left-${i}`).join('\n')
      const remote = Array.from({ length: 900 }, (_, i) => `right-${i}`).join('\n')
      const diff = computeLineDiff(local, remote)

      expect(diff.simplified).toBe(true)
      expect(diff.deletions).toBe(900)
      expect(diff.additions).toBe(900)
      expect(diff.hunks.length).toBeGreaterThan(0)
    })
  })

  describe('diffLocalAndRemote guardrails', () => {
    const baseReq = { sessionId: 's1', localPath: 'C:\\local\\app.ts', remotePath: '/srv/app.ts' }

    it('skips oversized files with a clear too-large notice', async () => {
      const res = await diffLocalAndRemote(baseReq, {
        readLocal: vi.fn(async () => ({ size: MAX_DIFF_BYTES + 10, isDir: false })),
        readRemote: vi.fn(async () => ({ size: 120, isDir: false, buffer: Buffer.from('ok') }))
      })
      expect(res.skipped).toEqual({
        reason: 'too-large',
        side: 'local',
        message: 'The local file exceeds the 1 MB built-in diff limit.'
      })
      expect(res.hunks).toEqual([])
    })

    it('skips binary files without attempting to render text hunks', async () => {
      const res = await diffLocalAndRemote(baseReq, {
        readLocal: vi.fn(async () => ({ size: 4, isDir: false, buffer: Buffer.from('text') })),
        readRemote: vi.fn(async () => ({ size: 4, isDir: false, buffer: Buffer.from([0x89, 0x50, 0x4e, 0x00]) }))
      })
      expect(res.skipped).toEqual({
        reason: 'binary',
        side: 'remote',
        message: 'The remote file appears to be binary and cannot be diffed as text.'
      })
      expect(res.hunks).toEqual([])
    })

    it('reports side "both" when both files are binary', async () => {
      const res = await diffLocalAndRemote(baseReq, {
        readLocal: vi.fn(async () => ({ size: 2, isDir: false, buffer: Buffer.from([0x00, 0x01]) })),
        readRemote: vi.fn(async () => ({ size: 2, isDir: false, buffer: Buffer.from([0x00, 0x02]) }))
      })
      expect(res.skipped?.side).toBe('both')
      expect(res.skipped?.reason).toBe('binary')
    })

    it('rejects directories with VALIDATION SshError', async () => {
      await expect(
        diffLocalAndRemote(baseReq, {
          readLocal: vi.fn(async () => ({ size: 0, isDir: true })),
          readRemote: vi.fn(async () => ({ size: 10, isDir: false, buffer: Buffer.from('hi') }))
        })
      ).rejects.toThrow('Cannot diff a directory.')
    })

    it('uses in-memory localContent when provided (including empty string)', async () => {
      const res = await diffLocalAndRemote(
        { ...baseReq, localContent: '' },
        {
          readRemote: vi.fn(async () => ({ size: 5, isDir: false, buffer: Buffer.from('hello') }))
        }
      )
      expect(res.localSize).toBe(0)
      expect(res.additions).toBe(1)
      expect(res.deletions).toBe(0)
    })
  })
})
