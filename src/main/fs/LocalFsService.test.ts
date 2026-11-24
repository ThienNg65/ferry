import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  abortStageDrop,
  beginStageDrop,
  cleanupAllStagedDrops,
  cleanupStagedDropPath,
  cleanupStagedDropPaths,
  finishStageDrop,
  list,
  MAX_STAGE_DROP_BYTES,
  openStageDropWriteStream,
  rename,
  stageDroppedEntries,
  touchStageDropSession
} from './LocalFsService'

describe('LocalFsService.stageDroppedEntries', () => {
  const stagedRoots: string[] = []

  afterEach(() => {
    while (stagedRoots.length > 0) {
      const dir = stagedRoots.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('stages single files and nested folders into a temp directory and returns top-level FileEntry items', async () => {
    const result = await stageDroppedEntries({
      entries: [
        { relativePath: 'deploy.sh', isDir: false, data: new TextEncoder().encode('#!/bin/sh\necho ok\n') },
        { relativePath: 'bundle', isDir: true },
        { relativePath: 'bundle/sub/config.json', isDir: false, data: new TextEncoder().encode('{"ok":true}') }
      ]
    })

    expect(result).toHaveLength(2)
    stagedRoots.push(path.dirname(result[0].path))

    expect(result[0]).toMatchObject({ name: 'deploy.sh', isDir: false })
    expect(existsSync(result[0].path)).toBe(true)
    expect(readFileSync(result[0].path, 'utf8')).toContain('echo ok')

    expect(result[1]).toMatchObject({ name: 'bundle', isDir: true })
    expect(readFileSync(path.join(result[1].path, 'sub', 'config.json'), 'utf8')).toBe('{"ok":true}')
  })

  it('reserves the staging ownership marker path for both staging transports', async () => {
    await expect(
      stageDroppedEntries({
        entries: [{ relativePath: '.ferry-stage-owner', isDir: false, data: new Uint8Array([1]) }]
      })
    ).rejects.toThrow(/ownership marker path is reserved/)
    await expect(
      stageDroppedEntries({
        entries: [{ relativePath: '.FERRY-STAGE-OWNER', isDir: false, data: new Uint8Array([1]) }]
      })
    ).rejects.toThrow(/ownership marker path is reserved/)

    const { stageId } = await beginStageDrop()
    await expect(openStageDropWriteStream(stageId, '.ferry-stage-owner')).rejects.toThrow(/ownership marker path is reserved/)
    await expect(openStageDropWriteStream(stageId, '.FERRY-STAGE-OWNER')).rejects.toThrow(/ownership marker path is reserved/)
    await abortStageDrop(stageId)
  })

  it('rejects path-traversal and drive-prefixed relative paths', async () => {
    await expect(
      stageDroppedEntries({
        entries: [{ relativePath: '../escape.txt', isDir: false, data: new Uint8Array([1]) }]
      })
    ).rejects.toThrow(/Unsafe dropped relative path/)

    await expect(
      stageDroppedEntries({
        entries: [{ relativePath: 'C:/Windows/win.ini', isDir: false, data: new Uint8Array([1]) }]
      })
    ).rejects.toThrow(/Invalid dropped relative path/)
  })

  it('cleans up staged drop paths and removes empty ferry-drop directories after upload', async () => {
    const result = await stageDroppedEntries({
      entries: [{ relativePath: 'temp-upload.txt', isDir: false, data: new TextEncoder().encode('upload-me') }]
    })
    const stageRoot = path.dirname(result[0].path)
    stagedRoots.push(stageRoot)

    expect(existsSync(result[0].path)).toBe(true)
    await cleanupStagedDropPath(result[0].path)
    expect(existsSync(result[0].path)).toBe(false)
    expect(existsSync(stageRoot)).toBe(false)
  })

  it('leaves ordinary files under matching-prefix directories untouched', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ferry-drop-user-data-'))
    const file = path.join(root, 'keep.txt')
    stagedRoots.push(root)
    writeFileSync(file, 'user data')

    await cleanupStagedDropPath(file)

    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('user data')
  })

  it('does not sweep matching-prefix directories with missing or malformed ownership markers', async () => {
    const missingMarkerRoot = mkdtempSync(path.join(os.tmpdir(), 'ferry-drop-unowned-'))
    const malformedMarkerRoot = mkdtempSync(path.join(os.tmpdir(), 'ferry-drop-malformed-'))
    stagedRoots.push(missingMarkerRoot, malformedMarkerRoot)
    const missingMarkerFile = path.join(missingMarkerRoot, 'keep.txt')
    const malformedMarkerFile = path.join(malformedMarkerRoot, 'keep.txt')
    writeFileSync(missingMarkerFile, 'user data')
    writeFileSync(malformedMarkerFile, 'user data')
    writeFileSync(path.join(malformedMarkerRoot, '.ferry-stage-owner'), 'not a Ferry marker')

    await cleanupStagedDropPath(missingMarkerFile)
    await cleanupStagedDropPath(malformedMarkerFile)
    await cleanupAllStagedDrops(0)

    expect(existsSync(missingMarkerFile)).toBe(true)
    expect(existsSync(malformedMarkerFile)).toBe(true)
  })

  it('cleans a marked staging root through the restart fallback during per-transfer cleanup', async () => {
    const result = await stageDroppedEntries({
      entries: [{ relativePath: 'restart-upload.txt', isDir: false, data: new TextEncoder().encode('upload-me') }]
    })
    const stageRoot = path.dirname(result[0].path)
    stagedRoots.push(stageRoot)

    vi.resetModules()
    const restartedFs = await import('./LocalFsService')
    await restartedFs.cleanupStagedDropPath(result[0].path)

    expect(existsSync(result[0].path)).toBe(false)
    expect(existsSync(stageRoot)).toBe(false)
  })

  it('sweeps marked stale staging roots left by a previous process', async () => {
    const result = await stageDroppedEntries({
      entries: [{ relativePath: 'restart-sweep.txt', isDir: false, data: new TextEncoder().encode('staged') }]
    })
    const stageRoot = path.dirname(result[0].path)
    stagedRoots.push(stageRoot)

    vi.resetModules()
    const restartedFs = await import('./LocalFsService')
    await restartedFs.cleanupAllStagedDrops(0)

    expect(existsSync(stageRoot)).toBe(false)
  })

  it('removes expired active staging sessions after validating their ownership marker', async () => {
    const initialTime = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(initialTime)
    try {
      const { stageId } = await beginStageDrop()
      const { stream, targetPath } = await openStageDropWriteStream(stageId, 'expired.txt')
      const stageRoot = path.dirname(targetPath)
      stagedRoots.push(stageRoot)
      await new Promise<void>((resolve, reject) => {
        stream.once('error', reject)
        stream.once('close', resolve)
        stream.end()
      })

      now.mockReturnValue(initialTime + 31 * 60 * 1000)
      const nextSession = await beginStageDrop()
      await abortStageDrop(nextSession.stageId)

      expect(existsSync(stageRoot)).toBe(false)
    } finally {
      now.mockRestore()
    }
  })

  it('keeps a streaming session alive when data progresses after its creation TTL', async () => {
    const initialTime = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(initialTime)
    try {
      const { stageId } = await beginStageDrop()
      const { stream, targetPath } = await openStageDropWriteStream(stageId, 'active.txt')
      const stageRoot = path.dirname(targetPath)
      stagedRoots.push(stageRoot)
      const closed = new Promise<void>((resolve, reject) => {
        stream.once('error', reject)
        stream.once('close', resolve)
      })

      stream.write('first')
      now.mockReturnValue(initialTime + 31 * 60 * 1000)
      stream.write('second')
      touchStageDropSession(stageId)

      const nextSession = await beginStageDrop()
      await abortStageDrop(nextSession.stageId)

      expect(existsSync(stageRoot)).toBe(true)
      await expect(finishStageDrop(stageId)).rejects.toMatchObject({ code: 'VALIDATION' })

      stream.end('third')
      await closed
      const entries = await finishStageDrop(stageId)
      expect(entries).toHaveLength(1)
      expect(readFileSync(entries[0].path, 'utf8')).toBe('firstsecondthird')
    } finally {
      now.mockRestore()
    }
  })


  it('keeps a session alive while a write remains buffered beyond the inactivity TTL', async () => {
    const initialTime = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(initialTime)
    try {
      const { stageId } = await beginStageDrop()
      const { stream, targetPath } = await openStageDropWriteStream(stageId, 'pending.txt')
      const stageRoot = path.dirname(targetPath)
      stagedRoots.push(stageRoot)
      stream.on('error', () => {})
      await new Promise<void>((resolve, reject) => {
        stream.once('open', resolve)
        stream.once('error', reject)
      })

      stream.cork()
      stream.write('pending')
      expect(stream.writableLength).toBeGreaterThan(0)

      now.mockReturnValue(initialTime + 31 * 60 * 1000)
      const nextSession = await beginStageDrop()
      expect(existsSync(stageRoot)).toBe(true)
      await abortStageDrop(nextSession.stageId)

      const closed = new Promise<void>((resolve, reject) => {
        stream.once('error', reject)
        stream.once('close', resolve)
      })
      stream.uncork()
      stream.end('complete')
      await closed

      const entries = await finishStageDrop(stageId)
      expect(entries).toHaveLength(1)
      expect(readFileSync(entries[0].path, 'utf8')).toBe('pendingcomplete')
    } finally {
      now.mockRestore()
    }
  })

  it('expires an idle open stream and closes it before removing its staging root', async () => {
    const initialTime = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(initialTime)
    try {
      const { stageId } = await beginStageDrop()
      const { stream, targetPath } = await openStageDropWriteStream(stageId, 'idle.txt')
      const stageRoot = path.dirname(targetPath)
      stagedRoots.push(stageRoot)
      await new Promise<void>((resolve, reject) => {
        stream.once('open', () => resolve())
        stream.once('error', reject)
      })
      const closed = new Promise<void>((resolve) => stream.once('close', resolve))

      now.mockReturnValue(initialTime + 31 * 60 * 1000)
      const nextSession = await beginStageDrop()
      await closed

      expect(stream.closed).toBe(true)
      expect(existsSync(stageRoot)).toBe(false)
      await abortStageDrop(nextSession.stageId)
      await expect(finishStageDrop(stageId)).rejects.toThrow(/not found or expired/)
    } finally {
      now.mockRestore()
    }
  })

  it('refreshes an idle session when streamed activity is recorded', async () => {
    const initialTime = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(initialTime)
    try {
      const { stageId } = await beginStageDrop()
      const { stream, targetPath } = await openStageDropWriteStream(stageId, 'completed.txt')
      const stageRoot = path.dirname(targetPath)
      stagedRoots.push(stageRoot)
      await new Promise<void>((resolve, reject) => {
        stream.once('error', reject)
        stream.once('close', resolve)
        stream.end('payload')
      })

      now.mockReturnValue(initialTime + 20 * 60 * 1000)
      touchStageDropSession(stageId)
      now.mockReturnValue(initialTime + 40 * 60 * 1000)

      const nextSession = await beginStageDrop()
      await abortStageDrop(nextSession.stageId)
      const entries = await finishStageDrop(stageId)

      expect(existsSync(stageRoot)).toBe(true)
      expect(entries).toHaveLength(1)
      expect(readFileSync(entries[0].path, 'utf8')).toBe('payload')
    } finally {
      now.mockRestore()
    }
  })

  it('closes active write streams before removing an aborted staging session', async () => {
    const { stageId } = await beginStageDrop()
    const { stream, targetPath } = await openStageDropWriteStream(stageId, 'aborted.txt')
    const stageRoot = path.dirname(targetPath)
    stagedRoots.push(stageRoot)
    stream.on('error', () => {})
    await new Promise<void>((resolve, reject) => {
      stream.once('open', () => resolve())
      stream.once('error', reject)
    })
    const closed = new Promise<void>((resolve) => stream.once('close', resolve))

    await abortStageDrop(stageId)
    await closed

    expect(stream.closed).toBe(true)
    expect(existsSync(stageRoot)).toBe(false)
    await expect(finishStageDrop(stageId)).rejects.toThrow(/not found or expired/)
  })

  it('refreshes the inactivity window across a multi-file staging session', async () => {
    const initialTime = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(initialTime)
    try {
      const { stageId } = await beginStageDrop()
      const first = await openStageDropWriteStream(stageId, 'first.txt')
      const stageRoot = path.dirname(first.targetPath)
      stagedRoots.push(stageRoot)
      await new Promise<void>((resolve, reject) => {
        first.stream.once('error', reject)
        first.stream.once('close', resolve)
        first.stream.end('first')
      })

      now.mockReturnValue(initialTime + 20 * 60 * 1000)
      const second = await openStageDropWriteStream(stageId, 'second.txt')
      await new Promise<void>((resolve, reject) => {
        second.stream.once('error', reject)
        second.stream.once('close', resolve)
        second.stream.end('second')
      })

      now.mockReturnValue(initialTime + 40 * 60 * 1000)
      const nextSession = await beginStageDrop()
      await abortStageDrop(nextSession.stageId)
      const entries = await finishStageDrop(stageId)

      expect(entries.map((entry) => entry.name)).toEqual(['first.txt', 'second.txt'])
    } finally {
      now.mockRestore()
    }
  })

  it('closes active streams and removes tracked staging roots during shutdown cleanup', async () => {
    const { stageId } = await beginStageDrop({ dirs: ['shutdown'] })
    const { stream, targetPath } = await openStageDropWriteStream(stageId, 'shutdown/file.txt')
    const stageRoot = path.dirname(path.dirname(targetPath))
    stagedRoots.push(stageRoot)
    stream.on('error', () => {})
    await new Promise<void>((resolve, reject) => {
      stream.once('open', () => resolve())
      stream.once('error', reject)
    })
    const closed = new Promise<void>((resolve) => stream.once('close', resolve))

    await cleanupAllStagedDrops()
    await closed

    expect(stream.closed).toBe(true)
    expect(existsSync(stageRoot)).toBe(false)
  })

  it('rejects staged drops larger than MAX_STAGE_DROP_BYTES', async () => {
    const oversized = new Uint8Array(MAX_STAGE_DROP_BYTES + 1)
    await expect(
      stageDroppedEntries({
        entries: [{ relativePath: 'too-big.bin', isDir: false, data: oversized }]
      })
    ).rejects.toThrow(/16 MB in-memory staging limit/)
  })

  it('streams files larger than 16 MB via begin/openStageDropWriteStream/finish without memory cap', async () => {
    const { stageId } = await beginStageDrop({ dirs: ['empty-dir', 'nested/sub'] })
    const { stream, targetPath } = await openStageDropWriteStream(stageId, 'nested/sub/big.bin', '2026-01-01T00:00:00.000Z')
    const chunk = Buffer.alloc(1024 * 1024, 0x41) // 1 MB chunk x 18 = 18 MB (> 16 MB)
    for (let i = 0; i < 18; i++) {
      if (!stream.write(chunk)) {
        await new Promise<void>((resolve) => stream.once('drain', resolve))
      }
    }
    await new Promise<void>((resolve, reject) => {
      stream.once('error', reject)
      stream.once('close', resolve)
      stream.end()
    })

    const result = await finishStageDrop(stageId)
    expect(result.map((e) => e.name)).toEqual(['empty-dir', 'nested'])
    const stageRoot = path.dirname(result[0].path)
    stagedRoots.push(stageRoot)

    expect(existsSync(path.join(stageRoot, 'empty-dir'))).toBe(true)
    expect(existsSync(targetPath)).toBe(true)
    const listed = await list(path.dirname(targetPath).replace(/\\/g, '/'))
    expect(listed.path).toBe(path.resolve(path.dirname(targetPath)))
    expect(listed.entries.find((e) => e.name === 'big.bin')?.size).toBe(18 * 1024 * 1024)

    await cleanupStagedDropPaths([result[0].path, result[1].path])
    expect(existsSync(stageRoot)).toBe(false)
  })

  it('rejects traversal paths in streaming stage drop and cleans up on abort', async () => {
    await expect(beginStageDrop({ dirs: ['../escape'] })).rejects.toThrow(/Unsafe dropped relative path/)
    const { stageId } = await beginStageDrop({ dirs: ['ok-dir'] })
    const { stream, targetPath } = await openStageDropWriteStream(stageId, 'ok-dir/file.txt')
    const stageRoot = path.dirname(path.dirname(targetPath))
    stagedRoots.push(stageRoot)
    await new Promise<void>((resolve, reject) => {
      stream.once('error', reject)
      stream.once('close', resolve)
      stream.end()
    })

    await expect(openStageDropWriteStream(stageId, 'C:/Windows/win.ini')).rejects.toThrow(/Invalid dropped relative path/)
    await abortStageDrop(stageId)
    expect(existsSync(stageRoot)).toBe(false)
    await expect(finishStageDrop(stageId)).rejects.toThrow(/not found/)
  })

  it('rejects duplicate relativePath writes within the same staging session', async () => {
    const { stageId } = await beginStageDrop()
    const first = await openStageDropWriteStream(stageId, 'dup.txt')
    first.stream.end()
    await expect(openStageDropWriteStream(stageId, 'dup.txt')).rejects.toThrow(/Duplicate staged relative path/)
    await abortStageDrop(stageId)
  })

  it('normalizes mixed slashes in list() via path.resolve', async () => {
    const tmpSub = path.join(os.tmpdir(), `ferry-list-norm-${Date.now()}`)
    mkdirSync(tmpSub, { recursive: true })
    stagedRoots.push(tmpSub)
    const mixed = tmpSub.replace(/\\/g, '/') + '/'
    const res = await list(mixed)
    expect(res.path).toBe(path.resolve(tmpSub))
  })
})

it('keeps both files when inline rename has no replacement approval', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ferry-rename-'))
  try {
    const source = path.join(root, 'source.txt')
    const destination = path.join(root, 'destination.txt')
    writeFileSync(source, 'source')
    writeFileSync(destination, 'destination')
    await expect(rename(source, destination, false)).rejects.toMatchObject({ code: 'ALREADY_EXISTS' })
    expect(readFileSync(source, 'utf8')).toBe('source')
    expect(readFileSync(destination, 'utf8')).toBe('destination')
    await rename(source, destination, true)
    expect(readFileSync(destination, 'utf8')).toBe('source')
    expect(existsSync(source)).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
