import { EventEmitter } from 'events'
import { spawn, type ChildProcess, type SpawnOptions } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import * as path from 'path'
import { tmpdir } from 'os'
import { describe, expect, it, vi } from 'vitest'
import { createPlatformOpenPath } from './nodeHost'

const existingPath = path.resolve(process.cwd(), 'package.json')
type SpawnFunction = typeof import('child_process').spawn

function createChild(): { child: ChildProcess; unref: ReturnType<typeof vi.fn> } {
  const unref = vi.fn()
  const child = Object.assign(new EventEmitter(), { unref }) as unknown as ChildProcess
  return { child, unref }
}

describe('createPlatformOpenPath', () => {
  it.each([
    { platform: 'darwin' as NodeJS.Platform, command: 'open' },
    { platform: 'linux' as NodeJS.Platform, command: 'xdg-open' },
    { platform: 'win32' as NodeJS.Platform, command: 'explorer.exe' }
  ])('uses $command on $platform', async ({ platform, command }) => {
    const { child, unref } = createChild()
    const spawnProcess = vi.fn(() => child) as unknown as SpawnFunction

    const result = createPlatformOpenPath(platform, spawnProcess)(existingPath)
    child.emit('spawn')

    await expect(result).resolves.toBe('')
    expect(spawnProcess).toHaveBeenCalledWith(command, [existingPath], {
      detached: true,
      stdio: 'ignore'
    })
    expect(unref).toHaveBeenCalledOnce()
  })

  it('returns a non-empty error when the platform opener cannot be spawned', async () => {
    const { child, unref } = createChild()
    const spawnProcess = vi.fn(() => child) as unknown as SpawnFunction
    const error = Object.assign(new Error('spawn xdg-open ENOENT'), { code: 'ENOENT' })

    const result = createPlatformOpenPath('linux', spawnProcess)(existingPath)
    child.emit('error', error)

    await expect(result).resolves.toBe(`Could not open ${existingPath}: ${error.message}`)
    expect(unref).not.toHaveBeenCalled()
  })

  it('returns an error without spawning when the target does not exist', async () => {
    const spawnProcess = vi.fn() as unknown as SpawnFunction
    const missingPath = path.join(process.cwd(), 'missing-open-path-target')

    await expect(createPlatformOpenPath('linux', spawnProcess)(missingPath))
      .resolves.toBe(`Could not open ${missingPath}: not found`)
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('fails clearly on unsupported platforms', async () => {
    const spawnProcess = vi.fn() as unknown as SpawnFunction

    await expect(createPlatformOpenPath('freebsd', spawnProcess)(existingPath))
      .resolves.toBe(`Could not open ${existingPath}: unsupported platform freebsd`)
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('returns an error when spawning throws synchronously', async () => {
    const spawnProcess = vi.fn(() => {
      throw new Error('spawn denied')
    }) as unknown as SpawnFunction

    await expect(createPlatformOpenPath('darwin', spawnProcess)(existingPath))
      .resolves.toBe(`Could not open ${existingPath}: spawn denied`)
  })

  it.skipIf(process.platform !== 'darwin')('launches a real file through macOS Launch Services', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ferry-open-path-'))
    const target = path.join(directory, 'ferry-open-path.txt')
    writeFileSync(target, 'Ferry macOS open-path smoke test\n')

    let childExit: Promise<number | null> | null = null
    const spawnProcess = ((command: string, args: string[], options: SpawnOptions) => {
      const child = spawn(command, args, options)
      childExit = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('macOS open command did not exit within 15 seconds')), 15_000)
        child.once('error', (error) => {
          clearTimeout(timeout)
          reject(error)
        })
        child.once('close', (code) => {
          clearTimeout(timeout)
          resolve(code)
        })
      })
      return child
    }) as SpawnFunction

    try {
      await expect(createPlatformOpenPath('darwin', spawnProcess)(target)).resolves.toBe('')
      const exit = childExit
      if (!exit) throw new Error('macOS opener process was not created')
      await expect(exit).resolves.toBe(0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 20_000)
})
