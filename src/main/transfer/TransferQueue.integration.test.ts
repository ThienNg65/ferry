/**
 * Integration tests for TransferQueue against a REAL SFTP/SSH server, driven
 * through the exact same path the app uses: SessionManager.openQuickConnect()
 * (real ssh2 handshake) feeding TransferQueue.enqueue()/enqueueTree() (real
 * SFTP streams). `electron`'s BrowserWindow is mocked (tests run outside an
 * Electron process) — everything else is real. See RemoteShell.integration.test.ts
 * for the docker command that starts the required test server.
 */
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'ssh2'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

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
    ;({ TransferQueue } = await import('./TransferQueue'))
    const result = await SessionManager.getInstance().openQuickConnect({
      name: 'ferry-test',
      host: HOST,
      port: PORT,
      username: USERNAME,
      authMethod: 'password',
      password: PASSWORD
    })
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
})
