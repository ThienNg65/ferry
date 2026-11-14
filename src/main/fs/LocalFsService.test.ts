import { existsSync, readFileSync, rmSync } from 'fs'
import * as path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupStagedDropPath, MAX_STAGE_DROP_BYTES, stageDroppedEntries } from './LocalFsService'

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
})
