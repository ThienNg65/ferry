/**
 * Integration tests for TransferQueue against a REAL SFTP/SSH server, driven
 * through the exact same path the app uses: SessionManager.openQuickConnect()
 * (real ssh2 handshake) feeding TransferQueue.enqueue()/enqueueTree() (real
 * SFTP streams). `electron`'s BrowserWindow is mocked (tests run outside an
 * Electron process) — everything else is real. See RemoteShell.integration.test.ts
 * for the docker command that starts the required test server.
 */
import { randomBytes, randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'ssh2'
import { host } from '../host/host'
import { EVENT_CHANNELS, type TransferEvent } from '../../shared/contract'

const HOST = '127.0.0.1'
const PORT = 2299
const USERNAME = 'ferrytest'
const PASSWORD = 'ferrytest123'
const REMOTE_BASE = '/config/ferry-test'

function probeServer(): Promise<boolean> {
  return new Promise((resolve) => {
    const client = new Client()
    client.on('ready', () => {
      client.end()
      resolve(true)
    })
    client.on('error', () => resolve(false))
    client.on('keyboard-interactive', (_n, _i, _l, _p, finish) => finish([PASSWORD]))
    client.connect({ host: HOST, port: PORT, username: USERNAME, password: PASSWORD, tryKeyboard: true, readyTimeout: 10_000 })
  })
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 10_000, intervalMs = 100): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await predicate()) {
      return
    }
    if (Date.now() > deadline) {
      throw new Error(`waitFor: condition not met within ${timeoutMs}ms`)
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

const serverAvailable = await probeServer()
if (!serverAvailable) {
  // eslint-disable-next-line no-console
  console.warn(
    `[TransferQueue.integration.test] Skipping — no test SFTP server reachable at ${HOST}:${PORT}. See RemoteShell.integration.test.ts for the docker run command.`
  )
}

describe.skipIf(!serverAvailable)('TransferQueue against a real SFTP/SSH server', () => {
  let SessionManager: typeof import('../ssh/SessionManager').SessionManager
  let TransferQueue: typeof import('./TransferQueue').TransferQueue
  let sessionId: string
  let remoteTestDir: string
  let localTestDir: string

  beforeAll(async () => {
    ;({ SessionManager } = await import('../ssh/SessionManager'))
    SessionManager.getInstance().setHostKeyPrompter(async () => true)
    ;({ TransferQueue } = await import('./TransferQueue'))
    const result = await SessionManager.getInstance().openQuickConnect({
      name: 'ferry-test',
      host: HOST,
      port: PORT,
      username: USERNAME,
      authMethod: 'password',
      password: PASSWORD
    }, 'test-session')
    sessionId = result.sessionId
  }, 15_000)

  afterAll(() => {
    SessionManager?.getInstance().close(sessionId)
  })

  afterEach(async () => {
    if (remoteTestDir) {
      await SessionManager.getInstance().shell(sessionId).deleteRecursive(remoteTestDir).catch(() => undefined)
    }
    if (localTestDir) {
      await fs.rm(localTestDir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  async function freshDirs(): Promise<{ remoteDir: string; localDir: string }> {
    const id = randomUUID()
    remoteTestDir = `${REMOTE_BASE}/${id}`
    localTestDir = path.join(os.tmpdir(), `ferry-test-${id}`)
    await SessionManager.getInstance().shell(sessionId).mkdir(remoteTestDir)
    await fs.mkdir(localTestDir, { recursive: true })
    return { remoteDir: remoteTestDir, localDir: localTestDir }
  }

  it('enqueue() uploads a single file end to end', async () => {
    const { remoteDir, localDir } = await freshDirs()
    const localFile = path.join(localDir, 'upload-me.txt')
    const content = 'hello from a real upload test'
    await fs.writeFile(localFile, content)
    const remoteFile = `${remoteDir}/upload-me.txt`

    TransferQueue.getInstance().enqueue(sessionId, 'upload', localFile, remoteFile)

    await waitFor(async () => {
      try {
        const stat = await SessionManager.getInstance().shell(sessionId).stat(remoteFile)
        return stat.size === Buffer.byteLength(content)
      } catch {
        return false
      }
    })
    const read = await SessionManager.getInstance().shell(sessionId).readFile(remoteFile, 1024)
    expect(read.content).toBe(content)
  })

  it('enqueue() downloads a single file end to end', async () => {
    const { remoteDir, localDir } = await freshDirs()
    const remoteFile = `${remoteDir}/download-me.txt`
    const content = 'hello from a real download test'
    await SessionManager.getInstance().shell(sessionId).exec(`printf '%s' ${JSON.stringify(content)} > ${remoteFile}`)
    const localFile = path.join(localDir, 'download-me.txt')

    TransferQueue.getInstance().enqueue(sessionId, 'download', localFile, remoteFile)

    await waitFor(async () => {
      try {
        const stat = await fs.stat(localFile)
        return stat.size === Buffer.byteLength(content)
      } catch {
        return false
      }
    })
    expect(await fs.readFile(localFile, 'utf-8')).toBe(content)
  })

  it('enqueueTree() uploads a nested directory tree, recreating structure and content remotely', async () => {
    const { remoteDir, localDir } = await freshDirs()
    const treeRoot = path.join(localDir, 'tree')
    await fs.mkdir(path.join(treeRoot, 'sub'), { recursive: true })
    await fs.writeFile(path.join(treeRoot, 'top.txt'), 'top-level')
    await fs.writeFile(path.join(treeRoot, 'sub', 'nested.txt'), 'nested-content')
    const remoteTreeRoot = `${remoteDir}/tree`

    TransferQueue.getInstance().enqueueTree(sessionId, 'upload', treeRoot, remoteTreeRoot)

    await waitFor(async () => {
      try {
        const stat = await SessionManager.getInstance().shell(sessionId).stat(`${remoteTreeRoot}/sub/nested.txt`)
        return stat.size === Buffer.byteLength('nested-content')
      } catch {
        return false
      }
    })
    const topRead = await SessionManager.getInstance().shell(sessionId).readFile(`${remoteTreeRoot}/top.txt`, 1024)
    expect(topRead.content).toBe('top-level')
    const nestedRead = await SessionManager.getInstance().shell(sessionId).readFile(`${remoteTreeRoot}/sub/nested.txt`, 1024)
    expect(nestedRead.content).toBe('nested-content')
  })

  it('enqueueTree() downloads a nested directory tree, recreating structure and content locally', async () => {
    const { remoteDir, localDir } = await freshDirs()
    const remoteTreeRoot = `${remoteDir}/tree`
    const shell = SessionManager.getInstance().shell(sessionId)
    await shell.mkdirRecursive(`${remoteTreeRoot}/sub`)
    await shell.exec(`printf 'top-level' > ${remoteTreeRoot}/top.txt`)
    await shell.exec(`printf 'nested-content' > ${remoteTreeRoot}/sub/nested.txt`)
    const localTreeRoot = path.join(localDir, 'tree')

    TransferQueue.getInstance().enqueueTree(sessionId, 'download', localTreeRoot, remoteTreeRoot)

    await waitFor(async () => {
      try {
        const stat = await fs.stat(path.join(localTreeRoot, 'sub', 'nested.txt'))
        return stat.size === Buffer.byteLength('nested-content')
      } catch {
        return false
      }
    })
    expect(await fs.readFile(path.join(localTreeRoot, 'top.txt'), 'utf-8')).toBe('top-level')
    expect(await fs.readFile(path.join(localTreeRoot, 'sub', 'nested.txt'), 'utf-8')).toBe('nested-content')
  })

  it('cancel() on a still-queued job prevents it from ever running', async () => {
    const { remoteDir, localDir } = await freshDirs()
    // Each source file is a few hundred KB so the first MAX_CONCURRENT jobs
    // stay busy long enough for the 4th (queued) job's cancel to matter.
    const payload = Buffer.alloc(400_000, 'x')
    const localFiles = await Promise.all(
      [0, 1, 2, 3].map(async (i) => {
        const p = path.join(localDir, `file${i}.bin`)
        await fs.writeFile(p, payload)
        return p
      })
    )

    const queue = TransferQueue.getInstance()
    const ids = localFiles.map((localFile, i) => queue.enqueue(sessionId, 'upload', localFile, `${remoteDir}/file${i}.bin`))
    // Job 3 (the 4th) must still be queued at this point — enqueue()/pump() are
    // fully synchronous up to the point work actually starts streaming.
    queue.cancel(ids[3])

    await waitFor(async () => {
      try {
        const stat = await SessionManager.getInstance().shell(sessionId).stat(`${remoteDir}/file2.bin`)
        return stat.size === payload.length
      } catch {
        return false
      }
    })
    // Give any (buggy) belated pickup of the cancelled job a chance to happen before asserting its absence.
    await new Promise((r) => setTimeout(r, 500))
    await expect(SessionManager.getInstance().shell(sessionId).stat(`${remoteDir}/file3.bin`)).rejects.toMatchObject({
      code: 'NOT_FOUND'
    })
  })
  it('an upload never exposes a half-written final file and cancel removes only its staging file', async () => {
    const { remoteDir, localDir } = await freshDirs()
    const localFile = path.join(localDir, 'slow.bin')
    await fs.writeFile(localFile, Buffer.alloc(1_000_000, 'x'))
    const remoteFile = `${remoteDir}/slow.bin`
    const shell = SessionManager.getInstance().shell(sessionId)
    const queue = TransferQueue.getInstance()

    queue.setBandwidthLimitKBps(200)
    try {
      const id = queue.enqueue(sessionId, 'upload', localFile, remoteFile)
      const stagingFiles = async () => (await shell.readdir(remoteDir))
        .filter((entry) => entry.filename.startsWith('.ferry-transfer-'))
      await waitFor(async () => (await stagingFiles()).length === 1)
      expect(await shell.stat(remoteFile).then(() => true, () => false)).toBe(false)
      queue.cancel(id)
      await waitFor(async () => (await stagingFiles()).length === 0)
      expect(await shell.stat(remoteFile).then(() => true, () => false)).toBe(false)
    } finally {
      queue.setBandwidthLimitKBps(null)
    }
  })

  it.each(['upload', 'download'] as const)('resumes a paused %s through a new verified SSH session', async (kind) => {
    const { remoteDir, localDir } = await freshDirs()
    const content = randomBytes(900_000)
    const localFile = path.join(localDir, 'reconnect.bin')
    const remoteFile = `${remoteDir}/reconnect.bin`
    const manager = SessionManager.getInstance()
    const originalId = sessionId
    const shell = manager.shell(originalId)
    const sftp = await shell.sftp()
    if (kind === 'download') {
      const seed = path.join(localDir, 'seed.bin')
      await fs.writeFile(seed, content)
      await new Promise<void>((resolve, reject) =>
        sftp.fastPut(seed, remoteFile, (error) => error ? reject(error) : resolve()))
    } else {
      await fs.writeFile(localFile, content)
    }

    const queue = TransferQueue.getInstance()
    const broadcast = vi.spyOn(host(), 'broadcast')
    let unrelatedId: string | undefined
    queue.setBandwidthLimitKBps(256)
    try {
      const id = queue.enqueue(originalId, kind, localFile, remoteFile)
      const events = (): TransferEvent[] => broadcast.mock.calls
        .filter(([channel]) => channel === EVENT_CHANNELS.transferEvent)
        .map(([, event]) => event as TransferEvent)
        .filter((event) => event.transferId === id)
      const last = (): TransferEvent | undefined => events().at(-1)
      await waitFor(async () => events().some((event) =>
        event.state === 'progress' && (event.bytesTransferred ?? 0) > 0))
      queue.pause(id)
      await waitFor(async () => last()?.state === 'paused')

      const stagingPaths = async (): Promise<string[]> => kind === 'upload'
        ? (await manager.shell(sessionId).readdir(remoteDir)).map((entry) => entry.filename).filter((name) => name.endsWith('.part'))
        : (await fs.readdir(localDir)).filter((name) => name.endsWith('.part'))
      const staged = await stagingPaths()
      expect(staged).toHaveLength(1)

      manager.close(originalId)
      expect(last()).toMatchObject({ state: 'paused', reconnectRequired: true })
      expect(() => queue.retry(id)).toThrow('Reconnect to the original server')
      unrelatedId = (await manager.openQuickConnect({
        name: 'unrelated address', host: 'localhost', port: PORT, username: USERNAME, authMethod: 'password', password: PASSWORD
      }, randomUUID())).sessionId
      expect(() => queue.retry(id)).toThrow('Reconnect to the original server')

      sessionId = (await manager.openQuickConnect({
        name: 'reconnected', host: HOST, port: PORT, username: USERNAME, authMethod: 'password', password: PASSWORD
      }, randomUUID())).sessionId
      expect(last()).toMatchObject({ state: 'paused', reconnectRequired: false })
      queue.retry(id)
      // While still throttled, verify the resumed attempt retains its owned staging file.
      await waitFor(async () => last()?.state === 'progress')
      expect(await stagingPaths()).toEqual(staged)
      queue.setBandwidthLimitKBps(null)
      await waitFor(async () => last()?.state === 'done')
      expect(last()?.sessionId).toBe(sessionId)

      if (kind === 'upload') {
        const copy = path.join(localDir, 'downloaded.bin')
        const target = await manager.shell(sessionId).sftp()
        await new Promise<void>((resolve, reject) =>
          target.fastGet(remoteFile, copy, (error) => error ? reject(error) : resolve()))
        expect(await fs.readFile(copy)).toEqual(content)
      } else {
        expect(await fs.readFile(localFile)).toEqual(content)
      }
      expect(await stagingPaths()).toEqual([])
    } finally {
      queue.setBandwidthLimitKBps(null)
      if (unrelatedId) manager.close(unrelatedId)
      if (sessionId === originalId) {
        sessionId = (await manager.openQuickConnect({
          name: 'cleanup', host: HOST, port: PORT, username: USERNAME, authMethod: 'password', password: PASSWORD
        }, randomUUID())).sessionId
      }
      broadcast.mockRestore()
    }
  }, 20_000)

  it.each(['source changed', 'staging missing'])('offers a fresh transfer when the %s', async (problem) => {
    const { remoteDir, localDir } = await freshDirs()
    const localFile = path.join(localDir, 'restart.bin')
    const remoteFile = `${remoteDir}/restart.bin`
    const original = Buffer.alloc(1_800_000, 'x')
    await fs.writeFile(localFile, original)
    const shell = SessionManager.getInstance().shell(sessionId)
    const queue = TransferQueue.getInstance()
    const broadcast = vi.spyOn(host(), 'broadcast')
    queue.setBandwidthLimitKBps(192)
    try {
      const id = queue.enqueue(sessionId, 'upload', localFile, remoteFile)
      const last = (): TransferEvent | undefined => broadcast.mock.calls
        .filter(([channel]) => channel === EVENT_CHANNELS.transferEvent)
        .map(([, event]) => event as TransferEvent)
        .filter((event) => event.transferId === id).at(-1)
      await waitFor(async () => {
        const event = last()
        const bytes = event?.bytesTransferred ?? 0
        return event?.state === 'progress' && bytes > 0 && bytes < original.length
      })
      queue.pause(id)
      await waitFor(async () => last()?.state === 'paused')
      const replacement = problem === 'source changed' ? Buffer.from('updated') : original
      if (problem === 'source changed') {
        await fs.writeFile(localFile, replacement)
      } else {
        const staging = (await shell.readdir(remoteDir)).find((entry) => entry.filename.endsWith('.part'))!
        await shell.unlink(`${remoteDir}/${staging.filename}`)
      }
      queue.retry(id)
      await waitFor(async () => last()?.state === 'error')
      expect(last()).toMatchObject({ restartRequired: true, error: expect.stringContaining('Restart the transfer') })
      expect(() => queue.retry(id)).toThrow('Restart the transfer')
      await expect(shell.stat(remoteFile)).rejects.toMatchObject({ code: 'NOT_FOUND' })
      queue.setBandwidthLimitKBps(null)
      queue.retry(id, true)
      await waitFor(async () => last()?.state === 'done')
      expect((await shell.readFile(remoteFile, replacement.length + 1)).content).toBe(replacement.toString())
    } finally {
      queue.setBandwidthLimitKBps(null)
      broadcast.mockRestore()
    }
  }, 25_000)

  it('a finished upload preserves a user-owned .part file and cleans up its staging file', async () => {
    const { remoteDir, localDir } = await freshDirs()
    const localFile = path.join(localDir, 'ok.txt')
    await fs.writeFile(localFile, 'done')
    const remoteFile = `${remoteDir}/ok.txt`
    const shell = SessionManager.getInstance().shell(sessionId)

    await shell.exec(`printf user-owned > ${remoteFile}.part`)
    TransferQueue.getInstance().enqueue(sessionId, 'upload', localFile, remoteFile)

    await waitFor(() => shell.stat(remoteFile).then(() => true, () => false))
    expect((await shell.readFile(`${remoteFile}.part`, 1024)).content).toBe('user-owned')
    expect((await shell.readdir(remoteDir)).some((entry) => entry.filename.startsWith('.ferry-transfer-'))).toBe(false)
  })
  it('overwriting a remote file keeps its mode and writes through a symlink', async () => {
    const { remoteDir, localDir } = await freshDirs()
    const shell = SessionManager.getInstance().shell(sessionId)
    const realFile = `${remoteDir}/real.sh`
    const link = `${remoteDir}/link.sh`
    await shell.exec(`printf old > ${realFile} && chmod 755 ${realFile} && ln -s ${realFile} ${link}`)
    const localFile = path.join(localDir, 'link.sh')
    await fs.writeFile(localFile, 'new content')

    TransferQueue.getInstance().enqueue(sessionId, 'upload', localFile, link)

    await waitFor(async () => (await shell.readFile(realFile, 1024)).content === 'new content')
    expect((await shell.stat(realFile)).mode & 0o777).toBe(0o755)
    expect((await shell.exec(`test -L ${link} && echo link`)).stdout.trim()).toBe('link')
  })

  it('pause keeps job-owned staging and resume finishes with identical bytes', async () => {
    const { remoteDir, localDir } = await freshDirs()
    const data = randomBytes(1_000_000)
    const localFile = path.join(localDir, 'pause.bin')
    await fs.writeFile(localFile, data)
    const remoteFile = `${remoteDir}/pause.bin`
    const shell = SessionManager.getInstance().shell(sessionId)
    const queue = TransferQueue.getInstance()

    queue.setBandwidthLimitKBps(300)
    try {
      const id = queue.enqueue(sessionId, 'upload', localFile, remoteFile)
      const findStaging = async () => (await shell.readdir(remoteDir))
        .find((entry) => entry.filename.startsWith('.ferry-transfer-'))
      await waitFor(async () => Boolean((await findStaging())?.size))
      queue.pause(id)
      await new Promise((r) => setTimeout(r, 500))
      const pausedSize = (await findStaging())!.size
      expect(pausedSize).toBeLessThan(data.length)
      expect(await shell.stat(remoteFile).then(() => true, () => false)).toBe(false)
      queue.setBandwidthLimitKBps(null)
      queue.retry(id)
      await waitFor(() => shell.stat(remoteFile).then((st) => st.size === data.length, () => false))
    } finally {
      queue.setBandwidthLimitKBps(null)
    }
    const sftp = await shell.sftp()
    const tmp = path.join(localDir, 'back.bin')
    await new Promise<void>((resolve, reject) => sftp.fastGet(remoteFile, tmp, (e) => (e ? reject(e) : resolve())))
    expect((await fs.readFile(tmp)).equals(data)).toBe(true)
  })
})
