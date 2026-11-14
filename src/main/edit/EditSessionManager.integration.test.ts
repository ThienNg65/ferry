import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'ssh2'

import { testHost } from '../host/testHost.setup'
import { setHost } from '../host/host'

const events: Array<{ editId: string; state: string }> = []

setHost({
  ...testHost,
  broadcast: (_c, evt) => events.push(evt as { editId: string; state: string }),
  openPath: vi.fn(async () => '')
})

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

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await predicate())) {
    if (Date.now() > deadline) {
      throw new Error('waitFor timed out')
    }
    await new Promise((r) => setTimeout(r, 100))
  }
}

const serverAvailable = await probeServer()
if (!serverAvailable) {
  // eslint-disable-next-line no-console
  console.warn(`[EditSessionManager.integration.test] Skipping — no test SFTP server at ${HOST}:${PORT}.`)
}

describe.skipIf(!serverAvailable)('EditSessionManager against a real SFTP server', () => {
  let SessionManager: typeof import('../ssh/SessionManager').SessionManager
  let EditSessionManager: typeof import('./EditSessionManager').EditSessionManager
  let remote: typeof import('../fs/RemoteFsService')
  let sessionId: string
  let scratch: string

  beforeAll(async () => {
    ;({ SessionManager } = await import('../ssh/SessionManager'))
    SessionManager.getInstance().setHostKeyPrompter(async () => true)
    ;({ EditSessionManager } = await import('./EditSessionManager'))
    remote = await import('../fs/RemoteFsService')
    sessionId = (
      await SessionManager.getInstance().openQuickConnect(
        { name: 'ferry-test', host: HOST, port: PORT, username: USERNAME, authMethod: 'password', password: PASSWORD },
        'edit-test-session'
      )
    ).sessionId
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'ferry-edit-it-'))
    await remote.mkdirRemote(sessionId, REMOTE_BASE).catch(() => undefined)
  }, 15_000)

  afterAll(async () => {
    await EditSessionManager?.getInstance().disposeAll()
    SessionManager?.getInstance().close(sessionId)
    await fs.rm(scratch, { recursive: true, force: true })
  })

  async function putRemote(remotePath: string, content: string): Promise<void> {
    const local = path.join(scratch, randomUUID())
    await fs.writeFile(local, content)
    await remote.uploadForEdit(sessionId, local, remotePath)
  }

  async function readRemote(remotePath: string): Promise<string> {
    const local = path.join(scratch, randomUUID())
    await remote.downloadForEdit(sessionId, remotePath, local)
    return fs.readFile(local, 'utf-8')
  }

  it('does not overwrite a file that changed on the server, and force-reupload does', async () => {
    const remotePath = `${REMOTE_BASE}/edit-${randomUUID()}.txt`
    await putRemote(remotePath, 'original')
    const manager = EditSessionManager.getInstance()
    const { editId, localTempPath } = await manager.openRemote(sessionId, remotePath, true)

    await putRemote(remotePath, 'changed by someone else, longer')
    await fs.writeFile(localTempPath, 'my edit')

    await waitFor(() => events.some((e) => e.editId === editId && e.state === 'remote-changed'))
    expect(await readRemote(remotePath)).toBe('changed by someone else, longer')

    await new Promise((r) => setTimeout(r, 1500))
    await fs.writeFile(localTempPath, 'my edit again')
    await new Promise((r) => setTimeout(r, 1500))
    expect(events.filter((e) => e.editId === editId && e.state === 'remote-changed')).toHaveLength(1)
    await fs.writeFile(localTempPath, 'my edit')
    await manager.forceReupload(editId)
    expect(await readRemote(remotePath)).toBe('my edit')

    const listing = await remote.listRemote(sessionId, REMOTE_BASE)
    expect(listing.entries.some((e) => e.name.includes('.ferry-tmp-'))).toBe(false)
    await SessionManager.getInstance().shell(sessionId).unlink(remotePath)
  }, 30_000)

  it('saves through a symlink without replacing it', async () => {
    const id = randomUUID()
    const real = `${REMOTE_BASE}/real-${id}.txt`
    const link = `${REMOTE_BASE}/link-${id}.txt`
    await putRemote(real, 'before')
    const shell = SessionManager.getInstance().shell(sessionId)
    const sftp = await shell.sftp()
    await new Promise<void>((res, rej) => sftp.symlink(real, link, (e) => (e ? rej(e) : res())))
    await putRemote(link, 'after')
    const st = await new Promise<{ isSymbolicLink(): boolean }>((res, rej) => sftp.lstat(link, (e, s) => (e ? rej(e) : res(s))))
    expect(st.isSymbolicLink()).toBe(true)
    expect(await readRemote(real)).toBe('after')
    await shell.unlink(link)
    await shell.unlink(real)
  }, 30_000)

  it('keeps the original when the fallback rename fails', async () => {
    const remotePath = `${REMOTE_BASE}/fallback-${randomUUID()}.txt`
    await putRemote(remotePath, 'keep me')
    const shell = SessionManager.getInstance().shell(sessionId)
    const sftp = (await shell.sftp()) as unknown as { ext_openssh_rename: unknown }
    const origExt = sftp.ext_openssh_rename
    const origRename = shell.rename.bind(shell)
    sftp.ext_openssh_rename = () => {
      throw new Error('Server does not support this extended request')
    }
    shell.rename = async (from: string, to: string) => {
      if (from.includes('.ferry-tmp-')) {
        throw new Error('simulated rename failure')
      }
      return origRename(from, to)
    }
    try {
      await expect(putRemote(remotePath, 'new content')).rejects.toThrow()
    } finally {
      sftp.ext_openssh_rename = origExt
      shell.rename = origRename
    }
    expect(await readRemote(remotePath)).toBe('keep me')
    const names = (await remote.listRemote(sessionId, REMOTE_BASE)).entries.map((e) => e.name)
    expect(names.some((n) => n.includes('.ferry-tmp-') || n.includes('.ferry-bak-'))).toBe(false)
    await shell.unlink(remotePath)
  }, 30_000)
})
