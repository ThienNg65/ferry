import { promises as fs } from 'fs'
import type {
  FileDiffHunk,
  FileDiffLine,
  FileDiffRequest,
  FileDiffResult
} from '../../shared/contract'
import { readRemoteBufferForDiff } from '../fs/RemoteFsService'
import { SshError } from '../ssh/errors'

/** Matches the built-in editor/preview text cap (1 MiB) so diffing stays responsive. */
export const MAX_DIFF_BYTES = 1_048_576

const BINARY_SAMPLE_BYTES = 8192
const MAX_MYERS_D = 1500

export interface DiffSideData {
  size: number
  isDir: boolean
  buffer?: Buffer
}

export interface DiffDeps {
  readLocal?: (req: FileDiffRequest, maxBytes: number) => Promise<DiffSideData>
  readRemote?: (req: FileDiffRequest, maxBytes: number) => Promise<DiffSideData>
}

/** Heuristic binary check: NUL byte or >30% non-text control bytes in the leading sample. */
export function isBinaryBuffer(buf: Buffer): boolean {
  if (buf.length === 0) return false
  const len = Math.min(buf.length, BINARY_SAMPLE_BYTES)
  let controlCount = 0
  for (let i = 0; i < len; i++) {
    const b = buf[i]
    if (b === 0) return true
    if (b < 0x09 || (b >= 0x0e && b <= 0x1f && b !== 0x1b)) {
      controlCount++
    }
  }
  return controlCount / len > 0.3
}

/** Splits text into lines after normalizing CRLF/CR to LF and stripping one trailing newline. */
export function splitNormalizedLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  if (normalized === '') return []
  const withoutTrailing = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  return withoutTrailing.split('\n')
}

interface RawOp {
  kind: 'context' | 'add' | 'remove'
  text: string
  localLine: number | null
  remoteLine: number | null
}

function myersMiddle(a: string[], b: string[], localOffset: number, remoteOffset: number): { ops: RawOp[]; simplified: boolean } {
  const n = a.length
  const m = b.length
  if (n === 0) {
    return {
      simplified: false,
      ops: b.map((text, idx) => ({ kind: 'add', text, localLine: null, remoteLine: remoteOffset + idx + 1 }))
    }
  }
  if (m === 0) {
    return {
      simplified: false,
      ops: a.map((text, idx) => ({ kind: 'remove', text, localLine: localOffset + idx + 1, remoteLine: null }))
    }
  }

  const cap = Math.min(n + m, MAX_MYERS_D)
  const offset = cap
  const v = new Int32Array(2 * cap + 1)
  v[offset + 1] = 0
  const trace: Int32Array[] = []

  for (let d = 0; d <= cap; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1]
      } else {
        x = v[offset + k - 1] + 1
      }
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        trace.push(v.subarray(offset - d, offset + d + 1).slice())
        return { ops: backtrackMyers(a, b, trace, localOffset, remoteOffset), simplified: false }
      }
    }
    trace.push(v.subarray(offset - d, offset + d + 1).slice())
  }

  const ops: RawOp[] = [
    ...a.map((text, idx) => ({ kind: 'remove' as const, text, localLine: localOffset + idx + 1, remoteLine: null })),
    ...b.map((text, idx) => ({ kind: 'add' as const, text, localLine: null, remoteLine: remoteOffset + idx + 1 }))
  ]
  return { ops, simplified: true }
}

function backtrackMyers(
  a: string[],
  b: string[],
  trace: Int32Array[],
  localOffset: number,
  remoteOffset: number
): RawOp[] {
  const reversed: RawOp[] = []
  let x = a.length
  let y = b.length

  for (let d = trace.length - 1; d >= 1; d--) {
    const prev = trace[d - 1]
    const prevOffset = d - 1
    const k = x - y
    let prevK: number
    if (k === -d || (k !== d && prev[prevOffset + k - 1] < prev[prevOffset + k + 1])) {
      prevK = k + 1
    } else {
      prevK = k - 1
    }
    const prevX = prev[prevOffset + prevK]
    const prevY = prevX - prevK

    while (x > prevX && y > prevY) {
      x--
      y--
      reversed.push({
        kind: 'context',
        text: a[x],
        localLine: localOffset + x + 1,
        remoteLine: remoteOffset + y + 1
      })
    }

    if (x > prevX) {
      x--
      reversed.push({ kind: 'remove', text: a[x], localLine: localOffset + x + 1, remoteLine: null })
    } else if (y > prevY) {
      y--
      reversed.push({ kind: 'add', text: b[y], localLine: null, remoteLine: remoteOffset + y + 1 })
    }
  }

  while (x > 0 && y > 0) {
    x--
    y--
    reversed.push({
      kind: 'context',
      text: a[x],
      localLine: localOffset + x + 1,
      remoteLine: remoteOffset + y + 1
    })
  }

  reversed.reverse()
  return reversed
}

function groupIntoHunks(ops: RawOp[], contextLines: number): FileDiffHunk[] {
  const changeIndices: number[] = []
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].kind !== 'context') changeIndices.push(i)
  }
  if (changeIndices.length === 0) return []

  const ranges: Array<{ start: number; end: number }> = []
  for (const idx of changeIndices) {
    const start = Math.max(0, idx - contextLines)
    const end = Math.min(ops.length - 1, idx + contextLines)
    const last = ranges[ranges.length - 1]
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end)
    } else {
      ranges.push({ start, end })
    }
  }

  return ranges.map(({ start, end }) => {
    const lines: FileDiffLine[] = ops.slice(start, end + 1)
    let localStart = 0
    let localCount = 0
    let remoteStart = 0
    let remoteCount = 0
    for (const line of lines) {
      if (line.localLine !== null) {
        if (localStart === 0) localStart = line.localLine
        localCount++
      }
      if (line.remoteLine !== null) {
        if (remoteStart === 0) remoteStart = line.remoteLine
        remoteCount++
      }
    }
    return { localStart, localCount, remoteStart, remoteCount, lines }
  })
}

/** Computes line-level hunks between local and remote text strings (local = old, remote = new). */
export function computeLineDiff(
  localText: string,
  remoteText: string,
  contextLines = 3
): { identical: boolean; additions: number; deletions: number; hunks: FileDiffHunk[]; simplified?: boolean } {
  const localLines = splitNormalizedLines(localText)
  const remoteLines = splitNormalizedLines(remoteText)

  let prefix = 0
  const minLen = Math.min(localLines.length, remoteLines.length)
  while (prefix < minLen && localLines[prefix] === remoteLines[prefix]) {
    prefix++
  }

  let suffix = 0
  while (
    suffix < localLines.length - prefix &&
    suffix < remoteLines.length - prefix &&
    localLines[localLines.length - 1 - suffix] === remoteLines[remoteLines.length - 1 - suffix]
  ) {
    suffix++
  }

  const midLocal = localLines.slice(prefix, localLines.length - suffix)
  const midRemote = remoteLines.slice(prefix, remoteLines.length - suffix)
  if (midLocal.length === 0 && midRemote.length === 0) {
    return { identical: true, additions: 0, deletions: 0, hunks: [] }
  }

  const { ops: midOps, simplified } = myersMiddle(midLocal, midRemote, prefix, prefix)

  // Include just enough prefix/suffix context lines to build accurate hunks without allocating full-file arrays.
  const preStart = Math.max(0, prefix - contextLines)
  const preOps: RawOp[] = []
  for (let i = preStart; i < prefix; i++) {
    preOps.push({ kind: 'context', text: localLines[i], localLine: i + 1, remoteLine: i + 1 })
  }

  const sufCount = Math.min(suffix, contextLines)
  const sufLocalStart = localLines.length - suffix
  const sufRemoteStart = remoteLines.length - suffix
  const sufOps: RawOp[] = []
  for (let i = 0; i < sufCount; i++) {
    sufOps.push({
      kind: 'context',
      text: localLines[sufLocalStart + i],
      localLine: sufLocalStart + i + 1,
      remoteLine: sufRemoteStart + i + 1
    })
  }

  const allOps = [...preOps, ...midOps, ...sufOps]
  const hunks = groupIntoHunks(allOps, contextLines)
  let additions = 0
  let deletions = 0
  for (const op of midOps) {
    if (op.kind === 'add') additions++
    else if (op.kind === 'remove') deletions++
  }

  return simplified
    ? { identical: false, additions, deletions, hunks, simplified: true }
    : { identical: false, additions, deletions, hunks }
}

async function defaultReadLocal(req: FileDiffRequest, maxBytes: number): Promise<DiffSideData> {
  if (req.localContent !== undefined) {
    const buffer = Buffer.from(req.localContent, 'utf-8')
    return buffer.length > maxBytes
      ? { size: buffer.length, isDir: false }
      : { size: buffer.length, isDir: false, buffer }
  }
  let stats
  try {
    stats = await fs.stat(req.localPath)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    const code = err.code === 'ENOENT' ? 'NOT_FOUND' : 'UNKNOWN'
    throw new SshError(code, `Cannot read "${req.localPath}": ${err.message}`)
  }
  if (stats.isDirectory()) {
    return { size: stats.size, isDir: true }
  }
  if (stats.size > maxBytes) {
    return { size: stats.size, isDir: false }
  }
  const buffer = await fs.readFile(req.localPath)
  return { size: stats.size, isDir: false, buffer }
}

async function defaultReadRemote(req: FileDiffRequest, maxBytes: number): Promise<DiffSideData> {
  return readRemoteBufferForDiff(req.sessionId, req.remotePath, maxBytes)
}

function describeSides(localFlag: boolean, remoteFlag: boolean): { side: 'local' | 'remote' | 'both'; label: string } {
  if (localFlag && remoteFlag) return { side: 'both', label: 'Both local and remote files' }
  if (localFlag) return { side: 'local', label: 'The local file' }
  return { side: 'remote', label: 'The remote file' }
}

/** Reads local and remote files up to `MAX_DIFF_BYTES`, guards binary/oversized files, and returns a line diff. */
export async function diffLocalAndRemote(req: FileDiffRequest, deps: DiffDeps = {}): Promise<FileDiffResult> {
  const readLocal = deps.readLocal ?? defaultReadLocal
  const readRemote = deps.readRemote ?? defaultReadRemote

  const [local, remote] = await Promise.all([
    readLocal(req, MAX_DIFF_BYTES),
    readRemote(req, MAX_DIFF_BYTES)
  ])

  if (local.isDir || remote.isDir) {
    throw new SshError('VALIDATION', 'Cannot diff a directory.')
  }

  const localTooLarge = local.size > MAX_DIFF_BYTES || local.buffer === undefined
  const remoteTooLarge = remote.size > MAX_DIFF_BYTES || remote.buffer === undefined
  if (localTooLarge || remoteTooLarge) {
    const { side, label } = describeSides(localTooLarge, remoteTooLarge)
    return {
      localPath: req.localPath,
      remotePath: req.remotePath,
      localSize: local.size,
      remoteSize: remote.size,
      maxBytes: MAX_DIFF_BYTES,
      skipped: {
        reason: 'too-large',
        side,
        message: `${label} exceed${side === 'both' ? '' : 's'} the 1 MB built-in diff limit.`
      },
      identical: false,
      additions: 0,
      deletions: 0,
      hunks: []
    }
  }

  const localBinary = isBinaryBuffer(local.buffer!)
  const remoteBinary = isBinaryBuffer(remote.buffer!)
  if (localBinary || remoteBinary) {
    const { side, label } = describeSides(localBinary, remoteBinary)
    return {
      localPath: req.localPath,
      remotePath: req.remotePath,
      localSize: local.size,
      remoteSize: remote.size,
      maxBytes: MAX_DIFF_BYTES,
      skipped: {
        reason: 'binary',
        side,
        message: `${label} appear${side === 'both' ? '' : 's'} to be binary and cannot be diffed as text.`
      },
      identical: false,
      additions: 0,
      deletions: 0,
      hunks: []
    }
  }

  const diff = computeLineDiff(local.buffer!.toString('utf-8'), remote.buffer!.toString('utf-8'))
  return {
    localPath: req.localPath,
    remotePath: req.remotePath,
    localSize: local.size,
    remoteSize: remote.size,
    maxBytes: MAX_DIFF_BYTES,
    ...diff
  }
}
