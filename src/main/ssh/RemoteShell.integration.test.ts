/**
 * Integration tests for RemoteShell against a REAL SFTP/SSH server.
 *
 * Requires a local test container. Start one with:
 *
 *   docker run -d --name ferry-test-sftp -p 2299:2222 \
 *     -e PUID=1000 -e PGID=1000 -e TZ=Etc/UTC \
 *     -e PASSWORD_ACCESS=true -e USER_NAME=ferrytest -e USER_PASSWORD=ferrytest123 \
 *     -e SUDO_ACCESS=false linuxserver/openssh-server
 *   docker exec ferry-test-sftp mkdir -p /config/ferry-test
 *   docker exec ferry-test-sftp chown ferrytest:users /config/ferry-test
 *
 * These tests connect a real ssh2.Client over TCP and exercise every
 * RemoteShell operation against real sshd/sftp-server behavior — nothing
 * here is mocked. Skips itself (with a console warning) if the server at
 * 127.0.0.1:2299 isn't reachable, rather than failing the whole suite.
 */
import { Client } from 'ssh2'
import { randomUUID } from 'crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { RemoteShell } from './RemoteShell'

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
    client.connect({ host: HOST, port: PORT, username: USERNAME, password: PASSWORD, tryKeyboard: true, readyTimeout: 10_000 })
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

// Vitest test files are ESM and support top-level await; this decides
// describe.skipIf's condition BEFORE the suite body below is collected,
// which a check inside beforeAll (running only once tests execute) could not.
const serverAvailable = await probeServer()
if (!serverAvailable) {
  // eslint-disable-next-line no-console
  console.warn(
    `[RemoteShell.integration.test] Skipping — no test SFTP server reachable at ${HOST}:${PORT}. See file header for the docker run command.`
  )
}

let client: Client
let shell: RemoteShell

beforeAll(async () => {
  client = await connect()
  shell = new RemoteShell(client)
}, 15_000)

afterAll(() => {
  client?.end()
})

let testDir: string

beforeEach(async () => {
  testDir = `${BASE_DIR}/${randomUUID()}`
  await shell.mkdir(testDir)
})

afterEach(async () => {
  await shell.deleteRecursive(testDir).catch(() => undefined)
})

describe.skipIf(!serverAvailable)('RemoteShell against a real SFTP/SSH server', () => {
  it('exec() runs a command and captures stdout/exit code', async () => {
    const result = await shell.exec('echo hello-ferry')
    expect(result.stdout.trim()).toBe('hello-ferry')
    expect(result.code).toBe(0)
  })

  it('exec() resolves (does not reject) on a non-zero exit code, reporting it via result.code', async () => {
    const result = await shell.exec('exit 3')
    expect(result.code).toBe(3)
  })

  it('execLines() streams stdout line by line', async () => {
    const lines: string[] = []
    const code = await shell.execLines('printf "a\\nb\\nc\\n"', { onLine: (l) => lines.push(l) })
    expect(lines).toEqual(['a', 'b', 'c'])
    expect(code).toBe(0)
  })

  it('mkdir + readdir + rename + unlink round-trip against real sftp-server', async () => {
    await shell.mkdir(`${testDir}/sub`)
    await shell.exec(`echo body > ${testDir}/file.txt`)

    const entries = await shell.readdir(testDir)
    const names = entries.map((e) => e.filename).sort()
    expect(names).toEqual(['file.txt', 'sub'])
    const dirEntry = entries.find((e) => e.filename === 'sub')
    expect(dirEntry?.isDirectory).toBe(true)
    const fileEntry = entries.find((e) => e.filename === 'file.txt')
    expect(fileEntry?.isDirectory).toBe(false)
    expect(fileEntry?.size).toBeGreaterThan(0)

    await shell.rename(`${testDir}/file.txt`, `${testDir}/renamed.txt`)
    const afterRename = await shell.readdir(testDir)
    expect(afterRename.map((e) => e.filename).sort()).toEqual(['renamed.txt', 'sub'])

    await shell.unlink(`${testDir}/renamed.txt`)
    const afterUnlink = await shell.readdir(testDir)
    expect(afterUnlink.map((e) => e.filename)).toEqual(['sub'])
  })

  it('realpath() resolves a relative-looking path to an absolute one', async () => {
    const resolved = await shell.realpath(testDir)
    expect(resolved).toBe(testDir)
  })

  it('stat() reports size and directory-ness', async () => {
    await shell.exec(`printf '12345' > ${testDir}/five.txt`)
    const stats = await shell.stat(`${testDir}/five.txt`)
    expect(stats.size).toBe(5)
    expect(stats.isDirectory()).toBe(false)

    const dirStats = await shell.stat(testDir)
    expect(dirStats.isDirectory()).toBe(true)
  })

  it('stat() on a missing path rejects with NOT_FOUND', async () => {
    await expect(shell.stat(`${testDir}/does-not-exist`)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('chmod() sets real permission bits, verified by both stat() and a live shell command', async () => {
    await shell.exec(`printf 'x' > ${testDir}/perms.txt`)
    await shell.chmod(`${testDir}/perms.txt`, '0640')

    const stats = await shell.stat(`${testDir}/perms.txt`)
    expect((stats.mode & 0o777).toString(8)).toBe('640')

    const ls = await shell.exec(`stat -c '%a' ${testDir}/perms.txt`)
    expect(ls.stdout.trim()).toBe('640')
  })

  it('chmod() accepts a mode string without a leading zero', async () => {
    await shell.exec(`printf 'x' > ${testDir}/perms2.txt`)
    await shell.chmod(`${testDir}/perms2.txt`, '755')
    const stats = await shell.stat(`${testDir}/perms2.txt`)
    expect((stats.mode & 0o777).toString(8)).toBe('755')
  })

  it('readFile() reads content and reports truncation correctly', async () => {
    await shell.exec(`printf 'hello world' > ${testDir}/text.txt`)
    const full = await shell.readFile(`${testDir}/text.txt`, 1024)
    expect(full.content).toBe('hello world')
    expect(full.truncated).toBe(false)
    expect(full.size).toBe(11)

    const capped = await shell.readFile(`${testDir}/text.txt`, 5)
    expect(capped.content).toBe('hello')
    expect(capped.truncated).toBe(true)
  })

  it('mkdirRecursive() creates nested missing parents in one call, and is idempotent', async () => {
    await shell.mkdirRecursive(`${testDir}/a/b/c`)
    const stats = await shell.stat(`${testDir}/a/b/c`)
    expect(stats.isDirectory()).toBe(true)
    // Second call on an already-existing tree must not throw.
    await expect(shell.mkdirRecursive(`${testDir}/a/b/c`)).resolves.toBeUndefined()
  })

  it('mkdirRecursive() is safe against a path containing a single quote (shellEscape)', async () => {
    const trickyPath = `${testDir}/o'brien`
    await expect(shell.mkdirRecursive(trickyPath)).resolves.toBeUndefined()
    const stats = await shell.stat(trickyPath)
    expect(stats.isDirectory()).toBe(true)
  })

  it('readdirRecursive() walks a nested tree depth-first, parents before children', async () => {
    await shell.mkdir(`${testDir}/dirA`)
    await shell.mkdir(`${testDir}/dirA/dirB`)
    await shell.exec(`printf 'x' > ${testDir}/dirA/dirB/leaf.txt`)
    await shell.exec(`printf 'yy' > ${testDir}/dirA/top.txt`)

    const tree = await shell.readdirRecursive(testDir)
    const relPaths = tree.map((e) => e.relPath)

    expect(relPaths).toContain('dirA')
    expect(relPaths).toContain('dirA/dirB')
    expect(relPaths).toContain('dirA/dirB/leaf.txt')
    expect(relPaths).toContain('dirA/top.txt')
    // Parent directory must be listed before its own children.
    expect(relPaths.indexOf('dirA')).toBeLessThan(relPaths.indexOf('dirA/dirB'))
    expect(relPaths.indexOf('dirA/dirB')).toBeLessThan(relPaths.indexOf('dirA/dirB/leaf.txt'))

    const leaf = tree.find((e) => e.relPath === 'dirA/dirB/leaf.txt')
    expect(leaf?.isDir).toBe(false)
    expect(leaf?.size).toBe(1)
    const top = tree.find((e) => e.relPath === 'dirA/top.txt')
    expect(top?.size).toBe(2)
  })

  it('deleteRecursive() removes a whole non-empty tree (files then dirs, deepest first)', async () => {
    await shell.mkdirRecursive(`${testDir}/deep/deeper`)
    await shell.exec(`printf 'x' > ${testDir}/deep/deeper/leaf.txt`)
    await shell.exec(`printf 'y' > ${testDir}/deep/sibling.txt`)

    await shell.deleteRecursive(`${testDir}/deep`)

    await expect(shell.stat(`${testDir}/deep`)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('deleteRecursive() on a plain file just unlinks it', async () => {
    await shell.exec(`printf 'x' > ${testDir}/lone.txt`)
    await shell.deleteRecursive(`${testDir}/lone.txt`)
    await expect(shell.stat(`${testDir}/lone.txt`)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
