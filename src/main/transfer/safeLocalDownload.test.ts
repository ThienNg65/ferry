import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertSafeLocalDownloadHandle,
  assertSafeLocalDownloadPath,
  ensureSafeLocalDownloadDirectory,
  prepareSafeLocalDownloadRoot
} from './safeLocalDownload'

const tempRoots: string[] = []

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) await fs.rm(root, { recursive: true, force: true })
  }
})

async function fixture(): Promise<{ base: string; root: string; outside: string }> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ferry-safe-download-'))
  tempRoots.push(base)
  const root = path.join(base, 'root')
  const outside = path.join(base, 'outside')
  await fs.mkdir(root)
  await fs.mkdir(outside)
  return { base, root, outside }
}

async function linkDirectory(target: string, link: string): Promise<void> {
  await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
}

describe('safe local tree download paths', () => {
  it('allows a symlink explicitly selected as the destination root', async () => {
    const { base, root } = await fixture()
    const selectedRoot = path.join(base, 'selected-root')
    await linkDirectory(root, selectedRoot)

    const resolved = await prepareSafeLocalDownloadRoot(selectedRoot)
    expect(resolved).toBe(await fs.realpath(root))

    const nested = path.join(resolved, 'config', 'nested')
    await ensureSafeLocalDownloadDirectory(resolved, nested)
    expect((await fs.stat(nested)).isDirectory()).toBe(true)
  })

  it('rejects a target path outside the selected root', async () => {
    const { root, outside } = await fixture()
    await expect(assertSafeLocalDownloadPath(root, path.join(outside, 'escape.txt'))).rejects.toThrow(
      /resolves outside the selected folder/
    )
  })

  it('rejects a symlinked directory before creating descendants outside the root', async () => {
    const { root, outside } = await fixture()
    const link = path.join(root, 'config')
    await linkDirectory(outside, link)

    await expect(ensureSafeLocalDownloadDirectory(root, link)).rejects.toThrow(/component "config".*symbolic links and reparse points/)
    await expect(assertSafeLocalDownloadPath(root, path.join(link, 'probe.txt'))).rejects.toThrow(
      /symbolic links and reparse points/
    )
    expect(await fs.readdir(outside)).toEqual([])
  })

  it('rejects a nested symlinked parent and leaves its target untouched', async () => {
    const { root, outside } = await fixture()
    const parent = path.join(root, 'config')
    await fs.mkdir(parent)
    await linkDirectory(outside, path.join(parent, 'nested'))

    await expect(assertSafeLocalDownloadPath(root, path.join(parent, 'nested', 'probe.txt'))).rejects.toThrow(
      /symbolic links and reparse points/
    )
    expect(await fs.readdir(outside)).toEqual([])
  })

  it('rejects a symlink at the final file path', async () => {
    const { root, outside } = await fixture()
    const sentinel = path.join(outside, 'sentinel.txt')
    await fs.writeFile(sentinel, 'keep-me')
    const link = path.join(root, 'probe.txt')
    try {
      await fs.symlink(sentinel, link, 'file')
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        return
      }
      throw error
    }

    await expect(assertSafeLocalDownloadPath(root, link)).rejects.toThrow(/symbolic links and reparse points/)
    expect(await fs.readFile(sentinel, 'utf-8')).toBe('keep-me')
  })

  it('rejects an opened handle that does not match the validated destination', async () => {
    const { root, outside } = await fixture()
    const parent = path.join(root, 'config')
    await fs.mkdir(parent)
    const target = path.join(parent, '.ferry-transfer-test.part')
    const outsideFile = path.join(outside, '.ferry-transfer-test.part')
    await fs.writeFile(target, 'inside-file')
    await fs.writeFile(outsideFile, 'different-outside-file-content')
    const handle = await fs.open(outsideFile, 'r+')

    try {
      await expect(assertSafeLocalDownloadHandle(root, target, handle)).rejects.toThrow(/component "\.ferry-transfer-test\.part"/)
      expect(await fs.readFile(target, 'utf-8')).toBe('inside-file')
      expect(await fs.readFile(outsideFile, 'utf-8')).toBe('different-outside-file-content')
    } finally {
      await handle.close()
    }
  })

  it('accepts a handle opened for its validated destination', async () => {
    const { root } = await fixture()
    const target = path.join(root, '.ferry-transfer-positive.part')
    const handle = await fs.open(target, 'wx', 0o600)

    try {
      const [opened, current] = await Promise.all([handle.stat(), fs.lstat(target)])
      const identity = (info: typeof opened) => ({
        dev: info.dev,
        ino: info.ino,
        size: info.size,
        mtimeMs: info.mtimeMs,
        birthtimeMs: info.birthtimeMs
      })
      expect(identity(opened)).toEqual(identity(current))
      await expect(assertSafeLocalDownloadHandle(root, target, handle)).resolves.toBeUndefined()
    } finally {
      await handle.close()
    }
  })

  it('allows ordinary nested directories and a missing final file', async () => {
    const { root } = await fixture()
    const nested = path.join(root, 'config', 'nested')
    await ensureSafeLocalDownloadDirectory(root, nested)
    await expect(assertSafeLocalDownloadPath(root, path.join(nested, 'probe.txt'))).resolves.toBeUndefined()
  })
})
