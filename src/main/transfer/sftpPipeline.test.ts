import { promises as fs } from 'fs'
import type { FileHandle } from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import type { SFTPWrapper } from 'ssh2'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { transferPipelined } from './sftpPipeline'
import { RateLimiter, TransferQueue } from './TransferQueue'
import { SessionManager } from '../ssh/SessionManager'
import type { RemoteShell } from '../ssh/RemoteShell'
import { testHost } from '../host/testHost.setup'
import { EVENT_CHANNELS, type TransferEvent } from '../../shared/contract'

interface FakeSftpOptions {
  maxWriteLen?: number
  maxReadLen?: number
  shortReadCap?: number
  reverseAckDelayMs?: boolean
}

function createFakeSftp(opts: FakeSftpOptions = {}) {
  const files = new Map<string, Buffer>()
  const handles = new Map<number, { path: string; flags: string }>()
  let nextHandleId = 1
  let inFlight = 0
  let maxConcurrent = 0
  let maxHandleCount = 0
  const openFlags: string[] = []

  const track = <T>(fn: () => Promise<T>): Promise<T> => {
    inFlight += 1
    maxConcurrent = Math.max(maxConcurrent, inFlight)
    return fn().finally(() => {
      inFlight -= 1
    })
  }

  const sftp = {
    _maxWriteLen: opts.maxWriteLen,
    _maxReadLen: opts.maxReadLen,
    open(remotePath: string, flags: string, _mode: number, cb: (err: Error | null, handle?: Buffer) => void) {
      openFlags.push(flags)
      setImmediate(() => {
        if (flags === 'r' || flags === 'r+') {
          if (!files.has(remotePath)) {
            cb(new Error(`ENOENT: ${remotePath}`))
            return
          }
        } else if (flags === 'w' || flags === 'wx') {
          if (flags === 'wx' && files.has(remotePath)) {
            cb(new Error(`EEXIST: ${remotePath}`))
            return
          }
          files.set(remotePath, Buffer.alloc(0))
        }
        const id = nextHandleId++
        handles.set(id, { path: remotePath, flags })
        maxHandleCount = Math.max(maxHandleCount, handles.size)
        const h = Buffer.alloc(4)
        h.writeUInt32BE(id, 0)
        cb(null, h)
      })
    },
    write(
      handle: Buffer,
      buf: Buffer,
      off: number,
      len: number,
      pos: number,
      cb: (err?: Error) => void
    ) {
      const id = handle.readUInt32BE(0)
      const entry = handles.get(id)
      if (!entry) {
        setImmediate(() => cb(new Error('Invalid handle')))
        return
      }
      const copy = Buffer.from(buf.subarray(off, off + len))
      void track(async () => {
        const delay = opts.reverseAckDelayMs ? Math.max(1, 20 - Math.floor(pos / 65536)) : 2
        await new Promise((r) => setTimeout(r, delay))
        if (!handles.has(id)) {
          throw new Error('Handle closed')
        }
        const existing = files.get(entry.path) ?? Buffer.alloc(0)
        const needed = pos + copy.length
        const target = existing.length >= needed ? existing : Buffer.concat([existing, Buffer.alloc(needed - existing.length)])
        copy.copy(target, pos)
        files.set(entry.path, target)
      }).then(
        () => cb(),
        (err: Error) => cb(err)
      )
    },
    read(
      handle: Buffer,
      buf: Buffer,
      off: number,
      len: number,
      pos: number,
      cb: (err: Error | null, bytesRead: number) => void
    ) {
      const id = handle.readUInt32BE(0)
      const entry = handles.get(id)
      if (!entry) {
        setImmediate(() => cb(new Error('Invalid handle'), 0))
        return
      }
      void track(async () => {
        await new Promise((r) => setTimeout(r, 2))
        const src = files.get(entry.path) ?? Buffer.alloc(0)
        if (pos >= src.length) return 0
        const avail = src.length - pos
        const cap = opts.shortReadCap ? Math.min(len, opts.shortReadCap, avail) : Math.min(len, avail)
        src.copy(buf, off, pos, pos + cap)
        return cap
      }).then(
        (nb) => cb(null, nb),
        (err: Error) => cb(err, 0)
      )
    },
    close(handle: Buffer, cb: (err?: Error) => void) {
      const id = handle.readUInt32BE(0)
      handles.delete(id)
      setImmediate(() => cb())
    }
  } as unknown as SFTPWrapper

  return {
    sftp,
    files,
    openFlags,
    getStats: () => ({ maxConcurrent, openHandlesLeft: handles.size, maxHandleCount })
  }
}

describe('sftpPipeline.transferPipelined', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ferry-pipeline-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('pipelines concurrent SFTP writes for uploads and produces byte-exact output', async () => {
    const localFile = path.join(tmpDir, 'upload.bin')
    const data = Buffer.alloc(512 * 1024)
    for (let i = 0; i < data.length; i++) data[i] = i & 0xff
    await fs.writeFile(localFile, data)

    const fake = createFakeSftp({ maxWriteLen: 64 * 1024, reverseAckDelayMs: true })
    const contigHistory: number[] = []
    const controller = new AbortController()

    await transferPipelined({
      sftp: fake.sftp,
      kind: 'upload',
      localPath: localFile,
      remotePath: '/remote/upload.bin.part',
      size: data.length,
      offset: 0,
      signal: controller.signal,
      rateLimiter: new RateLimiter(),
      onProgress: () => undefined,
      onContigOffset: (c) => contigHistory.push(c),
      concurrency: 8,
      chunkSize: 128 * 1024
    })

    expect(fake.files.get('/remote/upload.bin.part')?.equals(data)).toBe(true)
    expect(fake.getStats().maxConcurrent).toBeGreaterThan(1)
    expect(fake.getStats().openHandlesLeft).toBe(0)
    expect(contigHistory.at(-1)).toBe(data.length)
  })

  it('pipelines concurrent SFTP reads for downloads including short server reads', async () => {
    const data = Buffer.alloc(300 * 1024)
    for (let i = 0; i < data.length; i++) data[i] = (i * 7) & 0xff
    const fake = createFakeSftp({ maxReadLen: 64 * 1024, shortReadCap: 19 * 1024 })
    fake.files.set('/remote/down.bin', data)

    const localPart = path.join(tmpDir, 'down.bin.part')
    await transferPipelined({
      sftp: fake.sftp,
      kind: 'download',
      localPath: localPart,
      remotePath: '/remote/down.bin',
      size: data.length,
      offset: 0,
      signal: new AbortController().signal,
      rateLimiter: new RateLimiter(),
      onProgress: () => undefined,
      concurrency: 6,
      chunkSize: 128 * 1024
    })

    expect((await fs.readFile(localPart)).equals(data)).toBe(true)
    expect(fake.getStats().maxConcurrent).toBeGreaterThan(1)
    expect(fake.getStats().openHandlesLeft).toBe(0)
  })

  it('validates guarded local download handles before writing bytes', async () => {
    const data = Buffer.from('guarded-download')
    const fake = createFakeSftp()
    fake.files.set('/remote/guarded.txt', data)
    const destination = path.join(tmpDir, '.ferry-transfer-guarded.part')
    const beforeLocalOpen = vi.fn(async () => undefined)
    const afterLocalOpen = vi.fn(async (handle: FileHandle) => {
      expect((await handle.stat()).isFile()).toBe(true)
    })

    await transferPipelined({
      sftp: fake.sftp,
      kind: 'download',
      localPath: destination,
      remotePath: '/remote/guarded.txt',
      size: data.length,
      offset: 0,
      signal: new AbortController().signal,
      rateLimiter: new RateLimiter(),
      onProgress: () => undefined,
      beforeLocalOpen,
      afterLocalOpen,
      onDestinationCreated: () => undefined
    })

    expect(beforeLocalOpen).toHaveBeenCalledTimes(2)
    expect(afterLocalOpen).toHaveBeenCalledOnce()
    expect(await fs.readFile(destination)).toEqual(data)
  })

  it('overwrites an existing download destination when exclusive creation is not requested', async () => {
    const data = Buffer.from('new')
    const fake = createFakeSftp()
    fake.files.set('/remote/overwrite.txt', data)
    const destination = path.join(tmpDir, 'overwrite.txt')
    await fs.writeFile(destination, 'old-content-that-is-longer')

    await transferPipelined({
      sftp: fake.sftp,
      kind: 'download',
      localPath: destination,
      remotePath: '/remote/overwrite.txt',
      size: data.length,
      offset: 0,
      signal: new AbortController().signal,
      rateLimiter: new RateLimiter(),
      onProgress: () => undefined
    })

    expect(await fs.readFile(destination)).toEqual(data)
  })

  it('handles 0-byte files and resumes from offset > 0 with r+ without truncating', async () => {
    const fake = createFakeSftp()
    const emptyLocal = path.join(tmpDir, 'empty.txt')
    await fs.writeFile(emptyLocal, Buffer.alloc(0))
    await transferPipelined({
      sftp: fake.sftp,
      kind: 'upload',
      localPath: emptyLocal,
      remotePath: '/remote/empty.txt.part',
      size: 0,
      offset: 0,
      signal: new AbortController().signal,
      rateLimiter: new RateLimiter(),
      onProgress: () => undefined
    })
    expect(fake.files.get('/remote/empty.txt.part')).toEqual(Buffer.alloc(0))

    const fullData = Buffer.from('hello-world-resumed-payload')
    const resumeLocal = path.join(tmpDir, 'resume.txt')
    await fs.writeFile(resumeLocal, fullData)
    fake.files.set('/remote/resume.txt.part', fullData.subarray(0, 12))

    await transferPipelined({
      sftp: fake.sftp,
      kind: 'upload',
      localPath: resumeLocal,
      remotePath: '/remote/resume.txt.part',
      size: fullData.length,
      offset: 12,
      signal: new AbortController().signal,
      rateLimiter: new RateLimiter(),
      onProgress: () => undefined
    })

    expect(fake.openFlags).toContain('r+')
    expect(fake.files.get('/remote/resume.txt.part')).toEqual(fullData)
  })

  it('cancels promptly via AbortSignal and closes open handles', async () => {
    const localFile = path.join(tmpDir, 'cancel.bin')
    await fs.writeFile(localFile, Buffer.alloc(1024 * 1024, 1))
    const fake = createFakeSftp()
    const controller = new AbortController()
    const limiter = new RateLimiter()
    limiter.setLimitKBps(1)

    const p = transferPipelined({
      sftp: fake.sftp,
      kind: 'upload',
      localPath: localFile,
      remotePath: '/remote/cancel.bin.part',
      size: 1024 * 1024,
      offset: 0,
      signal: controller.signal,
      rateLimiter: limiter,
      onProgress: () => undefined,
      concurrency: 2,
      chunkSize: 64 * 1024
    })

    setTimeout(() => controller.abort(), 15)
    await expect(p).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(fake.getStats().openHandlesLeft).toBe(0)
  })

  it('refuses a staging-name collision without claiming or overwriting the file', async () => {
    const data = Buffer.from('source')
    const destination = path.join(tmpDir, 'existing.part')
    const fake = createFakeSftp()
    fake.files.set('/remote/source', data)
    await fs.writeFile(destination, 'user-owned')
    const onDestinationCreated = vi.fn()

    await expect(transferPipelined({
      sftp: fake.sftp,
      kind: 'download',
      localPath: destination,
      remotePath: '/remote/source',
      size: data.length,
      offset: 0,
      signal: new AbortController().signal,
      rateLimiter: new RateLimiter(),
      onProgress: vi.fn(),
      onDestinationCreated
    })).rejects.toMatchObject({ code: 'EEXIST' })
    expect(onDestinationCreated).not.toHaveBeenCalled()
    expect(await fs.readFile(destination, 'utf8')).toBe('user-owned')
  })

  it('keeps same-target jobs isolated through pause, cancellation and resume', async () => {
    const fake = createFakeSftp()
    const firstData = Buffer.alloc(512 * 1024, '1')
    const secondData = Buffer.alloc(512 * 1024, '2')
    fake.files.set('/remote/first', firstData)
    fake.files.set('/remote/second', secondData)
    const sessions = SessionManager.getInstance()
    vi.spyOn(sessions, 'connectedTransferSession').mockReturnValue('session')
    vi.spyOn(sessions, 'shell').mockReturnValue({
      sftp: async () => fake.sftp,
      stat: async (target: string) => ({ size: fake.files.get(target)!.length, mtime: 1 })
    } as unknown as RemoteShell)
    const events = vi.spyOn(testHost, 'broadcast')
    const state = (id: string, wanted: TransferEvent['state']): boolean => events.mock.calls.some(
      ([channel, event]) => channel === EVENT_CHANNELS.transferEvent
        && (event as TransferEvent).transferId === id && (event as TransferEvent).state === wanted
    )
    const stagingFiles = async (): Promise<string[]> => (await fs.readdir(tmpDir))
      .filter((name) => name.startsWith('.ferry-transfer-'))

    const queue = new TransferQueue()
    const destination = path.join(tmpDir, 'report.txt')
    await fs.writeFile(`${destination}.part`, 'user-owned')
    queue.setBandwidthLimitKBps(256)
    const first = queue.enqueue('session', 'download', destination, '/remote/first')
    const second = queue.enqueue('session', 'download', destination, '/remote/second')
    try {
      await vi.waitFor(async () => expect(await stagingFiles()).toHaveLength(2))
      queue.pause(first)
      queue.pause(second)
      await vi.waitFor(() => expect(state(first, 'paused') && state(second, 'paused')).toBe(true))
      queue.cancel(first)
      await vi.waitFor(async () => expect(await stagingFiles()).toHaveLength(1))
      queue.setBandwidthLimitKBps(null)
      queue.retry(second)
      await vi.waitFor(() => expect(state(second, 'done')).toBe(true))
      expect((await fs.readFile(destination)).equals(secondData)).toBe(true)
      expect(await fs.readFile(`${destination}.part`, 'utf8')).toBe('user-owned')
      expect(await stagingFiles()).toEqual([])
    } finally {
      queue.cancel(first)
      queue.cancel(second)
      queue.setBandwidthLimitKBps(null)
    }
  })

  it('downloads a tree into ordinary nested directories through the guarded path pipeline', async () => {
    const data = Buffer.from('normal-tree-download')
    const fake = createFakeSftp()
    fake.files.set('/remote/tree/nested/probe.txt', data)
    const sessions = SessionManager.getInstance()
    vi.spyOn(sessions, 'connectedTransferSession').mockReturnValue('session')
    vi.spyOn(sessions, 'shell').mockReturnValue({
      readdirRecursive: async () => [
        { relPath: 'nested', isDir: true, size: 0 },
        { relPath: 'nested/probe.txt', isDir: false, size: data.length, mtimeMs: 1_700_000_000_000 }
      ],
      sftp: async () => fake.sftp
    } as unknown as RemoteShell)

    const events = vi.spyOn(testHost, 'broadcast')
    const queue = new TransferQueue()
    const root = path.join(tmpDir, 'ordinary-tree')
    const transferId = queue.enqueueTree('session', 'download', root, '/remote/tree')
    const completed = (): boolean => events.mock.calls.some(
      ([channel, event]) => channel === EVENT_CHANNELS.transferEvent
        && (event as TransferEvent).transferId === transferId
        && (event as TransferEvent).state === 'done'
    )

    try {
      await vi.waitFor(() => expect(completed()).toBe(true))
      expect(await fs.readFile(path.join(root, 'nested', 'probe.txt'))).toEqual(data)
      expect(await fs.readdir(path.join(root, 'nested'))).toEqual(['probe.txt'])
    } finally {
      queue.cancel(transferId)
    }
  })

  it('rejects symlinked local parents for tree downloads before opening SFTP files', async () => {
    const root = path.join(tmpDir, 'tree')
    const outside = path.join(tmpDir, 'outside')
    await fs.mkdir(root)
    await fs.mkdir(outside)
    const sentinel = path.join(outside, 'sentinel.txt')
    await fs.writeFile(sentinel, 'keep-me')
    await fs.symlink(outside, path.join(root, 'config'), process.platform === 'win32' ? 'junction' : 'dir')

    const fake = createFakeSftp()
    const sessions = SessionManager.getInstance()
    vi.spyOn(sessions, 'connectedTransferSession').mockReturnValue('session')
    const getSftp = vi.fn(async () => fake.sftp)
    vi.spyOn(sessions, 'shell').mockReturnValue({
      readdirRecursive: async () => [
        { relPath: 'config', isDir: true, size: 0 },
        { relPath: 'config/probe.txt', isDir: false, size: 10, mtimeMs: 1 }
      ],
      sftp: getSftp
    } as unknown as RemoteShell)

    const events = vi.spyOn(testHost, 'broadcast')
    const queue = new TransferQueue()
    const transferId = queue.enqueueTree('session', 'download', root, '/remote/tree')
    const failed = (): boolean => events.mock.calls.some(
      ([channel, event]) => channel === EVENT_CHANNELS.transferEvent
        && (event as TransferEvent).transferId === transferId
        && (event as TransferEvent).state === 'error'
    )

    try {
      await vi.waitFor(() => expect(failed()).toBe(true))
      expect(getSftp).not.toHaveBeenCalled()
      expect(await fs.readFile(sentinel, 'utf-8')).toBe('keep-me')
      expect(await fs.readdir(outside)).toEqual(['sentinel.txt'])
    } finally {
      queue.cancel(transferId)
    }
  })

  it('does not hang indefinitely on abort when sftp.close never responds', async () => {
    const localFile = path.join(tmpDir, 'hung-close.bin')
    await fs.writeFile(localFile, Buffer.alloc(512 * 1024, 2))
    const fake = createFakeSftp()
    ;(fake.sftp as unknown as { close: () => void }).close = () => {
      // Simulate blackholed SSH connection that never sends SSH_FXP_STATUS for CLOSE.
    }
    const controller = new AbortController()
    const limiter = new RateLimiter()
    limiter.setLimitKBps(1)

    const started = Date.now()
    const p = transferPipelined({
      sftp: fake.sftp,
      kind: 'upload',
      localPath: localFile,
      remotePath: '/remote/hung-close.bin.part',
      size: 512 * 1024,
      offset: 0,
      signal: controller.signal,
      rateLimiter: limiter,
      onProgress: () => undefined,
      concurrency: 2,
      chunkSize: 64 * 1024
    })

    setTimeout(() => controller.abort(), 15)
    await expect(p).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(Date.now() - started).toBeLessThan(3500)
  })
})
