import { randomUUID } from 'crypto'
import { createWriteStream, promises as fs, writeFileSync } from 'fs'
import { Writable } from 'stream'
import { spawnSync } from 'child_process'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCompressCommand, compressLocal, splitRemotePath } from './CompressService'

// Fault-inject the actual writable boundary; keep the original writer for real ZIP tests.
vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>()
  return { ...real, createWriteStream: vi.fn(real.createWriteStream) }
})

/** Whether a POSIX shell is available to actually execute a built command against, for the injection tests below. */
function hasShell(): boolean {
  return spawnSync('sh', ['-c', 'true']).status === 0
}

let tmpDir: string | undefined

afterEach(async () => {
  vi.mocked(createWriteStream).mockClear()
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

describe('splitRemotePath', () => {
  it('splits a nested path into its parent directory and basename', () => {
    expect(splitRemotePath('/home/user/data/report.csv')).toEqual({ dir: '/home/user/data', base: 'report.csv' })
  })

  it('treats a top-level path as rooted at /', () => {
    expect(splitRemotePath('/report.csv')).toEqual({ dir: '/', base: 'report.csv' })
  })

  it('splits a folder path the same way as a file path', () => {
    expect(splitRemotePath('/srv/www/site')).toEqual({ dir: '/srv/www', base: 'site' })
  })

  it('strips trailing slashes and uses "." for bare relative names', () => {
    expect(splitRemotePath('/var/log/')).toEqual({ dir: '/var', base: 'log' })
    expect(splitRemotePath('file.txt')).toEqual({ dir: '.', base: 'file.txt' })
  })
})

describe('compressLocal', () => {
  it('zips a single file into a real, valid-looking .zip on disk', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `ferry-compress-${randomUUID()}-`))
    const sourceFile = path.join(tmpDir, 'report.csv')
    await fs.writeFile(sourceFile, 'a,b,c\n1,2,3\n')
    const destZip = path.join(tmpDir, 'report.csv.zip')

    await compressLocal(sourceFile, destZip)

    const stats = await fs.stat(destZip)
    expect(stats.size).toBeGreaterThan(0)
    const header = Buffer.alloc(4)
    const handle = await fs.open(destZip, 'r')
    try {
      await handle.read(header, 0, 4, 0)
    } finally {
      await handle.close()
    }
    // ZIP local-file-header magic number — confirms archiver actually produced a real zip, not just an empty/garbage file.
    expect(header).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  })

  it('zips a whole folder, rooting archive paths at the folder basename', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `ferry-compress-${randomUUID()}-`))
    const sourceDir = path.join(tmpDir, 'report')
    await fs.mkdir(sourceDir)
    await fs.writeFile(path.join(sourceDir, 'data.txt'), 'hello')
    const destZip = path.join(tmpDir, 'report.zip')

    await compressLocal(sourceDir, destZip)

    const stats = await fs.stat(destZip)
    expect(stats.size).toBeGreaterThan(0)
  })

  it('reports progress with growing processed byte counts', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `ferry-compress-${randomUUID()}-`))
    const sourceDir = path.join(tmpDir, 'report')
    await fs.mkdir(sourceDir)
    await fs.writeFile(path.join(sourceDir, 'a.txt'), 'x'.repeat(64 * 1024))
    await fs.writeFile(path.join(sourceDir, 'b.txt'), 'y'.repeat(64 * 1024))
    const destZip = path.join(tmpDir, 'report.zip')

    const processed: number[] = []
    await compressLocal(sourceDir, destZip, {
      onProgress: (processedBytes) => processed.push(processedBytes)
    })

    expect(processed.length).toBeGreaterThan(0)
    const sorted = [...processed].sort((a, b) => a - b)
    expect(processed).toEqual(sorted)
    expect(processed.at(-1)).toBeGreaterThan(0)
  })

  it('rejects a silent close before finish and removes the partial ZIP', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ferry-compress-early-close-'))
    const source = path.join(tmpDir, 'report.txt')
    const dest = path.join(tmpDir, 'report.zip')
    await fs.writeFile(source, 'important source content')
    let wrotePartial = false

    vi.mocked(createWriteStream).mockImplementationOnce((filePath) => {
      const output = new Writable({
        write(chunk) {
          writeFileSync(filePath, Buffer.from(chunk).subarray(0, 8))
          wrotePartial = true
          // No error event or finish: the backing destination disappears mid-write.
          queueMicrotask(() => output.destroy())
        }
      })
      return output as unknown as ReturnType<typeof createWriteStream>
    })

    await expect(compressLocal(source, dest)).rejects.toThrow('closed before finishing')
    expect(wrotePartial).toBe(true)
    await expect(fs.stat(dest)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves the disk-write error and removes the incomplete ZIP', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ferry-compress-write-error-'))
    const source = path.join(tmpDir, 'report.txt')
    const dest = path.join(tmpDir, 'report.zip')
    await fs.writeFile(source, 'important source content')
    let wrotePartial = false

    vi.mocked(createWriteStream).mockImplementationOnce((filePath) => {
      const output = new Writable({
        write(chunk, _encoding, callback) {
          writeFileSync(filePath, Buffer.from(chunk).subarray(0, 8))
          wrotePartial = true
          callback(Object.assign(new Error('disk full'), { code: 'ENOSPC' }))
        }
      })
      return output as unknown as ReturnType<typeof createWriteStream>
    })

    await expect(compressLocal(source, dest)).rejects.toMatchObject({ code: 'ENOSPC' })
    expect(wrotePartial).toBe(true)
    await expect(fs.stat(dest)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps CANCELLED classification and deletes a partially written ZIP', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ferry-compress-abort-'))
    const source = path.join(tmpDir, 'report.txt')
    const dest = path.join(tmpDir, 'report.zip')
    await fs.writeFile(source, 'important source content')
    const controller = new AbortController()
    let wrotePartial = false

    vi.mocked(createWriteStream).mockImplementationOnce((filePath) => {
      const output = new Writable({
        write(chunk) {
          writeFileSync(filePath, Buffer.from(chunk).subarray(0, 8))
          wrotePartial = true
          queueMicrotask(() => controller.abort())
        }
      })
      return output as unknown as ReturnType<typeof createWriteStream>
    })

    await expect(compressLocal(source, dest, { signal: controller.signal })).rejects.toMatchObject({
      code: 'CANCELLED'
    })
    expect(wrotePartial).toBe(true)
    await expect(fs.stat(dest)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects with CANCELLED on a pre-aborted signal and leaves no partial zip', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `ferry-compress-${randomUUID()}-`))
    const sourceFile = path.join(tmpDir, 'report.csv')
    await fs.writeFile(sourceFile, 'a,b,c\n')
    const destZip = path.join(tmpDir, 'report.csv.zip')

    const controller = new AbortController()
    controller.abort()
    await expect(compressLocal(sourceFile, destZip, { signal: controller.signal })).rejects.toMatchObject({
      code: 'CANCELLED'
    })
    await expect(fs.stat(destZip)).rejects.toThrow()
  })
})

describe('buildCompressCommand', () => {
  /**
   * Runs `command` through a real shell and asserts the `$(echo INJECTED)`
   * payload was never substituted/executed. Whether the built command reaches
   * the real `zip` invocation or short-circuits at the "tool missing" sentinel
   * depends on whether `zip` happens to be installed on the machine running
   * this test — either way, the payload must survive as inert literal text.
   * If it was executed, the literal `$(echo INJECTED)` text would be replaced
   * by its bare output (`INJECTED`) before ever reaching this point, so
   * stripping the literal-safe form and checking nothing is left catches an
   * injection regardless of which branch actually ran.
   */
  function assertPayloadNotExecuted(command: string): void {
    const result = spawnSync('sh', ['-c', command], { encoding: 'utf8' })
    const output = (result.stdout + result.stderr).replaceAll('$(echo INJECTED)', '')
    expect(output).not.toContain('INJECTED')
  }

  it.runIf(hasShell())('is safe against a remote path containing a command-substitution payload', () => {
    assertPayloadNotExecuted(buildCompressCommand('/tmp/$(echo INJECTED)file', '/tmp/out.zip'))
  })

  it.runIf(hasShell())('is safe against a destination path containing a double quote and a payload', () => {
    assertPayloadNotExecuted(buildCompressCommand('/tmp/source', '/tmp/"$(echo INJECTED)"file'))
  })

  it('separates the source argument from zip flags with `--` so a leading-dash basename cannot be parsed as an option', () => {
    const command = buildCompressCommand('/tmp/-Tinject', '/tmp/out.zip')
    expect(command).toMatch(/zip -rq \S+ -- \S+/)
  })
})
