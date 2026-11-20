import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync, type WriteStream } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Writable } from 'stream'
import { setHost } from '../host/host'
import { testHost } from '../host/testHost.setup'
import { SidecarUpdater } from './SidecarUpdater'

describe('SidecarUpdater installer write failures', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'ferry-updater-write-fault-'))
    setHost({ ...testHost, isPackaged: true, appVersion: '0.22.0' })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function makeUpdater(makeStream: (filePath: string) => WriteStream): SidecarUpdater {
    const payload = Buffer.from('MZ-fault-injection-installer')
    const sha512 = createHash('sha512').update(payload).digest('base64')
    const yaml = `version: 0.24.0\npath: Ferry-Setup-0.24.0.exe\nsha512: ${sha512}\n`
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith('latest.yml')
        ? new Response(yaml, { status: 200 })
        : new Response(new Uint8Array(payload), { status: 200 })
    ) as unknown as typeof fetch
    return new SidecarUpdater({
      feedUrl: 'https://example.invalid/releases',
      downloadDir: dir,
      fetchImpl,
      createWriteStreamImpl: ((filePath: string) => makeStream(filePath)) as typeof import('fs').createWriteStream
    })
  }

  for (const code of ['ENOSPC', 'EACCES']) {
    it(`rejects ${code} during backpressured chunk write, removes partial file and emits error`, async () => {
      const fault = Object.assign(new Error(`write ${code}`), { code })
      const updater = makeUpdater((filePath) => {
        writeFileSync(filePath, 'partial')
        return new Writable({
          highWaterMark: 1,
          write(_chunk, _encoding, callback) {
            process.nextTick(() => callback(fault))
          }
        }) as WriteStream
      })
      const errors: Error[] = []
      updater.on('error', (error: Error) => errors.push(error))
      const { downloadPromise } = await updater.checkForUpdates()
      await expect(downloadPromise).rejects.toThrow(`write ${code}`)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toBe(fault)
      expect(existsSync(path.join(dir, 'Ferry-Setup-0.24.0.exe.tmp'))).toBe(false)
      expect(updater.getDownloadedInfo()).toEqual({ version: null, installerPath: null })
    })
  }

  it('rejects premature close while finishing instead of accepting a truncated installer', async () => {
    const updater = makeUpdater((filePath) => {
      writeFileSync(filePath, 'partial')
      return new Writable({
        write(_chunk, _encoding, callback) { callback() },
        final(_callback) {
          process.nextTick(() => this.destroy())
        }
      }) as WriteStream
    })
    const errors: Error[] = []
    updater.on('error', (error: Error) => errors.push(error))
    const { downloadPromise } = await updater.checkForUpdates()
    await expect(downloadPromise).rejects.toThrow(/closed before finishing/)
    expect(errors).toHaveLength(1)
    expect(existsSync(path.join(dir, 'Ferry-Setup-0.24.0.exe.tmp'))).toBe(false)
  })
})
