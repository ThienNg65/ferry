import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'ssh2'

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

describe.skipIf(!serverAvailable)('edit as root over sudo -n against a real server', () => {
  let SessionManager: typeof import('../ssh/SessionManager').SessionManager
  let service: typeof import('./RemoteFsService')
  let sessionId: string
  let remoteDir: string
  let localDir: string
  let sudoWorks = false

  beforeAll(async () => {
    ;({ SessionManager } = await import('../ssh/SessionManager'))
    SessionManager.getInstance().setHostKeyPrompter(async () => true)
    service = await import('./RemoteFsService')
    const result = await SessionManager.getInstance().openQuickConnect(
      { name: 'ferry-test', host: HOST, port: PORT, username: USERNAME, authMethod: 'password', password: PASSWORD },
      'sudo-test-session'
    )
    sessionId = result.sessionId
    const shell = SessionManager.getInstance().shell(sessionId)
    sudoWorks = (await shell.exec('sudo -n true')).code === 0
    const id = randomUUID()
    remoteDir = `${REMOTE_BASE}/${id}`
    localDir = path.join(os.tmpdir(), `ferry-sudo-${id}`)
    await shell.mkdir(remoteDir)
    await fs.mkdir(localDir, { recursive: true })
  }, 15_000)

  afterAll(async () => {
    await SessionManager?.getInstance().shell(sessionId).deleteRecursive(remoteDir).catch(() => undefined)
    await fs.rm(localDir, { recursive: true, force: true }).catch(() => undefined)
    SessionManager?.getInstance().close(sessionId)
  })

  it('round-trips a file through sudo when allowed, otherwise reports that passwordless sudo is required', async () => {
    const shell = SessionManager.getInstance().shell(sessionId)
    const remoteFile = `${remoteDir}/rooted.txt`
    await shell.exec(`printf 'original' > ${remoteFile} && chmod 640 ${remoteFile}`)
    const localFile = path.join(localDir, 'rooted.txt')

    if (!sudoWorks) {
      await expect(service.downloadForEditSudo(sessionId, remoteFile, localFile)).rejects.toThrow(/Passwordless sudo is required/)
      return
    }

    await service.downloadForEditSudo(sessionId, remoteFile, localFile)
    expect(await fs.readFile(localFile, 'utf-8')).toBe('original')
    await fs.writeFile(localFile, 'changed é')
    await service.uploadForEditSudo(sessionId, localFile, remoteFile)
    expect((await shell.exec(`cat ${remoteFile}`)).stdout).toBe('changed é')
    expect((await shell.exec(`stat -c %a ${remoteFile}`)).stdout.trim()).toBe('640')
    expect((await shell.exec(`ls ${remoteDir}`)).stdout.trim()).toBe('rooted.txt')
    expect(await service.statRemoteSudo(sessionId, remoteFile)).not.toBeNull()
  })
})
