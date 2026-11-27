import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Client } from 'ssh2'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setHost } from '../host/host'
import { testHost } from '../host/testHost.setup'
import { diffLocalAndRemote, MAX_DIFF_BYTES } from './FileDiffService'

setHost(testHost)

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

const serverAvailable = await probeServer()
if (!serverAvailable) {
  // eslint-disable-next-line no-console
  console.warn(`[FileDiffService.integration.test] Skipping — no test SFTP server at ${HOST}:${PORT}.`)
}

describe.skipIf(!serverAvailable)('FileDiffService against a real SFTP server', () => {
  let SessionManager: typeof import('../ssh/SessionManager').SessionManager
  let remote: typeof import('../fs/RemoteFsService')
  let sessionId: string
  let scratch: string
  let remoteDir: string

  beforeAll(async () => {
    ;({ SessionManager } = await import('../ssh/SessionManager'))
    SessionManager.getInstance().setHostKeyPrompter(async () => true)
    remote = await import('../fs/RemoteFsService')
    sessionId = (
      await SessionManager.getInstance().openQuickConnect(
        { name: 'ferry-test', host: HOST, port: PORT, username: USERNAME, authMethod: 'password', password: PASSWORD },
        'diff-test-session'
      )
    ).sessionId
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'ferry-diff-it-'))
    remoteDir = `${REMOTE_BASE}/diff-${randomUUID()}`
    await remote.mkdirRemote(sessionId, REMOTE_BASE).catch(() => undefined)
    await remote.mkdirRemote(sessionId, remoteDir)
  }, 15_000)

  afterAll(async () => {
    if (remote && sessionId && remoteDir) {
      await remote.removeRemote(sessionId, remoteDir).catch(() => undefined)
    }
    SessionManager?.getInstance().close(sessionId)
    if (scratch) {
      await fs.rm(scratch, { recursive: true, force: true })
    }
  })

  async function seedPair(name: string, localData: string | Buffer, remoteData: string | Buffer): Promise<{ localPath: string; remotePath: string }> {
    const localPath = path.join(scratch, name)
    const remoteStage = path.join(scratch, `remote-${randomUUID()}-${name}`)
    const remotePath = `${remoteDir}/${name}`
    await fs.writeFile(localPath, localData)
    await fs.writeFile(remoteStage, remoteData)
    await remote.uploadForEdit(sessionId, remoteStage, remotePath)
    return { localPath, remotePath }
  }

  it('computes a real line-by-line diff over SFTP', async () => {
    const { localPath, remotePath } = await seedPair(
      'config.yml',
      'port: 8080\nhost: localhost\nlog: info\n',
      'port: 8443\nhost: localhost\nlog: debug\nssl: true\n'
    )

    const result = await diffLocalAndRemote({ sessionId, localPath, remotePath })

    expect(result.skipped).toBeUndefined()
    expect(result.identical).toBe(false)
    expect(result.deletions).toBe(2)
    expect(result.additions).toBe(3)
    expect(result.hunks).toHaveLength(1)
    expect(result.hunks[0].lines).toEqual([
      { kind: 'remove', text: 'port: 8080', localLine: 1, remoteLine: null },
      { kind: 'add', text: 'port: 8443', localLine: null, remoteLine: 1 },
      { kind: 'context', text: 'host: localhost', localLine: 2, remoteLine: 2 },
      { kind: 'remove', text: 'log: info', localLine: 3, remoteLine: null },
      { kind: 'add', text: 'log: debug', localLine: null, remoteLine: 3 },
      { kind: 'add', text: 'ssl: true', localLine: null, remoteLine: 4 }
    ])
  })

  it('treats CRLF local and LF remote with matching text as identical', async () => {
    const { localPath, remotePath } = await seedPair(
      'same.txt',
      'alpha\r\nbeta\r\n',
      'alpha\nbeta\n'
    )

    const result = await diffLocalAndRemote({ sessionId, localPath, remotePath })
    expect(result.identical).toBe(true)
    expect(result.hunks).toEqual([])
  })

  it('skips a binary remote file without crashing or emitting raw text hunks', async () => {
    const { localPath, remotePath } = await seedPair(
      'payload.bin',
      'plain text local\n',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03])
    )

    const result = await diffLocalAndRemote({ sessionId, localPath, remotePath })
    expect(result.skipped).toEqual({
      reason: 'binary',
      side: 'remote',
      message: 'The remote file appears to be binary and cannot be diffed as text.'
    })
    expect(result.hunks).toEqual([])
  })

  it('skips an oversized remote file via SFTP stat without reading its stream', async () => {
    const oversized = Buffer.alloc(MAX_DIFF_BYTES + 1024, 0x61)
    const { localPath, remotePath } = await seedPair('huge.log', 'small local\n', oversized)

    const result = await diffLocalAndRemote({ sessionId, localPath, remotePath })
    expect(result.remoteSize).toBe(MAX_DIFF_BYTES + 1024)
    expect(result.skipped).toEqual({
      reason: 'too-large',
      side: 'remote',
      message: 'The remote file exceeds the 1 MB built-in diff limit.'
    })
    expect(result.hunks).toEqual([])
  }, 15_000)

  it('diffs in-memory localContent against the real remote SFTP file', async () => {
    const { localPath, remotePath } = await seedPair(
      'live-edit.ts',
      'on disk\n',
      'line 1\nline 2 on server\n'
    )

    const result = await diffLocalAndRemote({
      sessionId,
      localPath,
      remotePath,
      localContent: 'line 1\nline 2 local draft\n'
    })
    expect(result.identical).toBe(false)
    expect(result.deletions).toBe(1)
    expect(result.additions).toBe(1)
  })
})
