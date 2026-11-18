import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  abortStageDrop,
  beginStageDrop,
  cleanupStagedDropPath,
  cleanupStagedDropPaths,
  finishStageDrop,
  list,
  MAX_STAGE_DROP_BYTES,
  openStageDropWriteStream,
  stageDroppedEntries
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
      stream.on('error', reject)
      stream.end(resolve)
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
    await expect(openStageDropWriteStream(stageId, 'C:/Windows/win.ini')).rejects.toThrow(/Invalid dropped relative path/)
    await abortStageDrop(stageId)
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
