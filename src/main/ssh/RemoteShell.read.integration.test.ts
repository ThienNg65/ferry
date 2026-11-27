/**
 * Live SFTP integration coverage for the bounded remote-read implementation.
 *
 * Start the same LinuxServer OpenSSH container used by CI:
 *
 *   docker run -d --name ferry-test-sftp -p 2299:2222 \
 *     -e PUID=1000 -e PGID=1000 -e TZ=Etc/UTC \
 *     -e PASSWORD_ACCESS=true -e USER_NAME=ferrytest -e USER_PASSWORD=ferrytest123 \
 *     -e SUDO_ACCESS=false lscr.io/linuxserver/openssh-server:latest
 *   docker exec ferry-test-sftp mkdir -p /config/ferry-test
 *   docker exec ferry-test-sftp chown ferrytest:users /config/ferry-test
 *
 * CI sets FERRY_REQUIRE_SSH_INTEGRATION=1 so a missing server fails the job.
 */
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile as readLocalFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from 'ssh2'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadForEdit } from '../fs/RemoteFsService'
import { SessionManager } from './SessionManager'
import { RemoteShell } from './RemoteShell'
import { shellEscape } from './shellEscape'

const HOST = '127.0.0.1'
const PORT = 2299
const USERNAME = 'ferrytest'
const PASSWORD = 'ferrytest123'
const BASE_DIR = '/config/ferry-test'

function connect(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    client.on('ready', () => resolve(client))
    client.on('error', reject)
    client.on('keyboard-interactive', (_name, _instructions, _lang, _prompts, finish) => {
      finish([PASSWORD])
    })
    client.connect({
      host: HOST,
      port: PORT,
      username: USERNAME,
      password: PASSWORD,
      tryKeyboard: true,
      readyTimeout: 10_000
    })
  })
}

async function probeServer(): Promise<boolean> {
  try {
    const probeClient = await connect()
    probeClient.end()
    return true
  } catch {
    return false
  }
}

const serverAvailable = await probeServer()
if (!serverAvailable) {
  if (process.env.FERRY_REQUIRE_SSH_INTEGRATION === '1') {
    throw new Error(`Required SSH/SFTP integration server is unavailable at ${HOST}:${PORT}`)
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[RemoteShell.read.integration.test] Skipping — no test SFTP server reachable at ${HOST}:${PORT}.`
  )
}

let client: Client
let shell: RemoteShell
let testDir: string
let localDir: string

describe.skipIf(!serverAvailable)('Remote SFTP read integration', () => {
  beforeAll(async () => {
    client = await connect()
    shell = new RemoteShell(client)
  }, 15_000)

  afterAll(() => {
    client?.end()
  })

  beforeEach(async () => {
    testDir = `${BASE_DIR}/${randomUUID()}`
    localDir = await mkdtemp(join(tmpdir(), 'ferry-sftp-read-integration-'))
    await shell.mkdir(testDir)
  })

  afterEach(async () => {
    await shell.deleteRecursive(testDir).catch(() => undefined)
    await rm(localDir, { recursive: true, force: true })
  })
  it('reads complete and truncated previews from a real SFTP server', async () => {
    const remotePath = `${testDir}/preview.txt`
    const content = 'hello from a real SFTP server'
    const write = await shell.exec(`printf '%s' ${shellEscape(content)} > ${shellEscape(remotePath)}`)
    expect(write.code).toBe(0)

    const full = await shell.readFile(remotePath, 1024, {
      idleTimeoutMs: 5_000,
      timeoutMs: 15_000
    })
    expect(full).toEqual({
      content,
      truncated: false,
      size: Buffer.byteLength(content)
    })

    const truncated = await shell.readFile(remotePath, 5, {
      idleTimeoutMs: 5_000,
      timeoutMs: 15_000
    })
    expect(truncated).toEqual({
      content: 'hello',
      truncated: true,
      size: Buffer.byteLength(content)
    })
  })

  it('downloads the complete remote file for the external editor', async () => {
    const remotePath = `${testDir}/editor.txt`
    const localPath = join(localDir, 'editor.txt')
    const content = 'complete external-editor download'
    const write = await shell.exec(`printf '%s' ${shellEscape(content)} > ${shellEscape(remotePath)}`)
    expect(write.code).toBe(0)

    const getInstance = vi.spyOn(SessionManager, 'getInstance').mockReturnValue({
      shell: () => shell
    } as unknown as SessionManager)
    const onProgress = vi.fn()

    try {
      await downloadForEdit('sftp-integration', remotePath, localPath, onProgress, undefined, {
        idleTimeoutMs: 5_000,
        timeoutMs: 15_000
      })

      expect(await readLocalFile(localPath, 'utf8')).toBe(content)
      expect(onProgress).toHaveBeenLastCalledWith(Buffer.byteLength(content))
    } finally {
      getInstance.mockRestore()
    }
  })
})
