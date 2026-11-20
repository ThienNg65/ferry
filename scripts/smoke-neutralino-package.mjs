import { execFileSync, spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import * as os from 'os'
import { dirname, join, posix as pathPosix, resolve } from 'path'
import { fileURLToPath } from 'url'
import ssh2Pkg from 'ssh2'
import { WebSocketServer } from 'ws'
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit'

const require = createRequire(import.meta.url)
const { verifyUpdateYml } = require('../.github/scripts/regenerate-update-yml.js')

const { Server: SshServer, utils: sshUtils } = ssh2Pkg
const { STATUS_CODE } = sshUtils.sftp

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const distDir = join(rootDir, 'dist')
const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
const version = String(pkg.version || '0.24.0')

const protoDir = join(distDir, 'ferry-neutralino-win_x64')
const zipPath = join(distDir, `Ferry-Portable-${version}-win-x64.zip`)
const installerPath = join(distDir, `Ferry-Setup-${version}.exe`)
const manifestPath = join(distDir, 'latest.yml')

function assertExists(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing packaged artifact (${label}): ${filePath}`)
  }
}

assertExists(join(protoDir, 'ferry-win_x64.exe'), 'Neutralino binary')
assertExists(join(protoDir, 'resources.neu'), 'Neutralino resources')
assertExists(join(protoDir, 'extensions', 'js.ferry.sidecar', 'node.exe'), 'Bundled Node runtime')
assertExists(join(protoDir, 'extensions', 'js.ferry.sidecar', 'index.cjs'), 'Bundled sidecar CJS')
assertExists(zipPath, 'Portable ZIP archive')
if (process.platform === 'win32' && process.env.FERRY_REQUIRE_NSIS === '1') {
  assertExists(installerPath, 'Required Ferry NSIS installer')
  assertExists(manifestPath, 'Required Ferry update manifest')
}

// Verify PE icon bytes match resources/icon.ico and version branding is set on the packaged Neutralino executable.
{
  const exe = NtExecutable.from(readFileSync(join(protoDir, 'ferry-win_x64.exe')), { ignoreCert: true })
  const res = NtExecutableResource.from(exe)
  const iconGroups = Resource.IconGroupEntry.fromEntries(res.entries)
  if (iconGroups.length === 0) {
    throw new Error('ferry-win_x64.exe is missing embedded PE icon resources')
  }
  const expectedIco = Data.IconFile.from(readFileSync(join(rootDir, 'resources', 'icon.ico')))
  const embeddedIcons = iconGroups[0].icons.map((item) => res.entries.find((e) => e.type === 3 && e.id === item.iconID))
  if (iconGroups[0].icons.length !== expectedIco.icons.length) {
    throw new Error(`Expected ${expectedIco.icons.length} PE icon resolutions, got ${iconGroups[0].icons.length}`)
  }
  for (let i = 0; i < expectedIco.icons.length; i++) {
    const actualEntry = embeddedIcons[i]
    const expectedBytes = Buffer.from(expectedIco.icons[i].data.bin)
    if (!actualEntry || !Buffer.from(actualEntry.bin).equals(expectedBytes)) {
      throw new Error(`PE icon entry ${i} does not match resources/icon.ico`)
    }
  }
  const viList = Resource.VersionInfo.fromEntries(res.entries)
  if (viList.length === 0) {
    throw new Error('ferry-win_x64.exe is missing PE VersionInfo')
  }
  const strings = viList[0].getStringValues({ lang: 1033, codepage: 1200 })
  if (strings.ProductName !== 'Ferry' || strings.FileDescription !== 'Ferry') {
    throw new Error(`Unexpected PE VersionInfo branding: ${JSON.stringify(strings)}`)
  }
}

const tempInstallRoot = mkdtempSync(join(os.tmpdir(), 'ferry-smoke-install-'))
const tempAppData = mkdtempSync(join(os.tmpdir(), 'ferry-smoke-appdata-'))
let runtimeDir = protoDir
let ranNsisInstaller = false
let child = null
let wss = null
let sshServer = null

/** Starts an in-process SSH + SFTP + PTY test server for packaged end-to-end verification. */
async function startSmokeSshServer() {
  const { private: privateKey } = sshUtils.generateKeyPairSync('ed25519')

  const vDirs = new Set(['/', '/home', '/home/tester'])
  const vFiles = new Map([
    ['/home/tester/welcome.txt', Buffer.from('hello from remote sftp\n', 'utf8')],
    ['/home/tester/app.log', Buffer.from('2026-11-13 INFO service started\n', 'utf8')]
  ])
  const nowSec = Math.floor(Date.now() / 1000)

  const makeAttrs = (isDir, size) => ({
    mode: (isDir ? 0o040755 : 0o100644),
    uid: 1000,
    gid: 1000,
    size,
    atime: nowSec,
    mtime: nowSec
  })

  const normPath = (p) => {
    if (!p || p === '.' || p === '~') return '/home/tester'
    return pathPosix.normalize(p.startsWith('/') ? p : `/home/tester/${p}`).replace(/\/+$/, '') || '/'
  }

  const server = new SshServer({ hostKeys: [privateKey] }, (client) => {
    client.on('error', () => {
      // Ignore ECONNRESET when the packaged sidecar tears down the socket on session:close.
    })
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'tester' && ctx.password === 'smoke-secret-password') {
        ctx.accept()
      } else {
        ctx.reject(['password'])
      }
    })

    client.on('ready', () => {
      client.on('session', (acceptSession) => {
        const session = acceptSession()
        session.on('pty', (accept) => accept?.())

        session.on('shell', (accept) => {
          const stream = accept()
          stream.write('SMOKE_PTY_READY\r\n')
          stream.on('data', (chunk) => {
            stream.write(chunk)
          })
        })

        session.on('exec', (accept, _reject, info) => {
          const stream = accept()
          const cmd = String(info.command || '')
          if (cmd.includes('FERRYPID:')) {
            stream.write('FERRYPID:4242\n')
            const logData = vFiles.get('/home/tester/app.log')
            if (logData) stream.write(logData)
            stream.on('close', () => {})
            return
          }
          if (cmd.includes('$SHELL')) {
            stream.write('SMOKE_PTY_READY\r\n')
            stream.on('data', (chunk) => stream.write(chunk))
            return
          }
          // Non-zero exit on remote list probe forces SFTP REALPATH/OPENDIR/READDIR fallback verification.
          stream.exit(1)
          stream.end()
        })

        session.on('sftp', (accept) => {
          const sftp = accept()
          const openHandles = new Map()
          let nextHandleId = 1

          const toHandle = (entry) => {
            const buf = Buffer.allocUnsafe(4)
            buf.writeUInt32BE(nextHandleId++, 0)
            openHandles.set(buf.readUInt32BE(0), entry)
            return buf
          }
          const getHandle = (buf) => (Buffer.isBuffer(buf) && buf.length >= 4 ? openHandles.get(buf.readUInt32BE(0)) : undefined)

          sftp.on('REALPATH', (reqid, p) => {
            const np = normPath(p)
            sftp.name(reqid, [{ filename: np, longname: np, attrs: makeAttrs(vDirs.has(np), vFiles.get(np)?.length ?? 0) }])
          })

          const handleStat = (reqid, p) => {
            const np = normPath(p)
            if (vDirs.has(np)) return sftp.attrs(reqid, makeAttrs(true, 0))
            const data = vFiles.get(np)
            if (data) return sftp.attrs(reqid, makeAttrs(false, data.length))
            sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE)
          }
          sftp.on('STAT', handleStat)
          sftp.on('LSTAT', handleStat)
          sftp.on('FSTAT', (reqid, handle) => {
            const entry = getHandle(handle)
            if (!entry) return sftp.status(reqid, STATUS_CODE.FAILURE)
            handleStat(reqid, entry.path)
          })

          sftp.on('MKDIR', (reqid, p) => {
            const np = normPath(p)
            vDirs.add(np)
            sftp.status(reqid, STATUS_CODE.OK)
          })

          sftp.on('OPENDIR', (reqid, p) => {
            const np = normPath(p)
            if (!vDirs.has(np)) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE)
            sftp.handle(reqid, toHandle({ type: 'dir', path: np, done: false }))
          })

          sftp.on('READDIR', (reqid, handle) => {
            const entry = getHandle(handle)
            if (!entry || entry.type !== 'dir') return sftp.status(reqid, STATUS_CODE.FAILURE)
            if (entry.done) return sftp.status(reqid, STATUS_CODE.EOF)
            entry.done = true
            const prefix = entry.path === '/' ? '/' : `${entry.path}/`
            const items = []
            for (const dir of vDirs) {
              if (dir !== entry.path && dir.startsWith(prefix) && !dir.slice(prefix.length).includes('/')) {
                const name = dir.slice(prefix.length)
                items.push({ filename: name, longname: `drwxr-xr-x 1 tester tester 0 Nov 13 00:00 ${name}`, attrs: makeAttrs(true, 0) })
              }
            }
            for (const [filePath, buf] of vFiles) {
              if (filePath.startsWith(prefix) && !filePath.slice(prefix.length).includes('/')) {
                const name = filePath.slice(prefix.length)
                items.push({ filename: name, longname: `-rw-r--r-- 1 tester tester ${buf.length} Nov 13 00:00 ${name}`, attrs: makeAttrs(false, buf.length) })
              }
            }
            sftp.name(reqid, items)
          })

          sftp.on('OPEN', (reqid, p, flags) => {
            const np = normPath(p)
            const writeFlag = (flags & sshUtils.sftp.OPEN_MODE.WRITE) !== 0
            if (writeFlag) {
              const trunc = (flags & sshUtils.sftp.OPEN_MODE.TRUNC) !== 0 || !vFiles.has(np)
              if (trunc) vFiles.set(np, Buffer.alloc(0))
              sftp.handle(reqid, toHandle({ type: 'file', path: np }))
              return
            }
            if (!vFiles.has(np)) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE)
            sftp.handle(reqid, toHandle({ type: 'file', path: np }))
          })

          sftp.on('READ', (reqid, handle, offset, len) => {
            const entry = getHandle(handle)
            const content = entry ? vFiles.get(entry.path) : null
            if (!content) return sftp.status(reqid, STATUS_CODE.FAILURE)
            if (offset >= content.length) return sftp.status(reqid, STATUS_CODE.EOF)
            sftp.data(reqid, content.subarray(offset, offset + len))
          })

          sftp.on('WRITE', (reqid, handle, offset, data) => {
            const entry = getHandle(handle)
            if (!entry) return sftp.status(reqid, STATUS_CODE.FAILURE)
            const cur = vFiles.get(entry.path) ?? Buffer.alloc(0)
            const needed = offset + data.length
            const next = needed > cur.length ? Buffer.concat([cur, Buffer.alloc(needed - cur.length)]) : Buffer.from(cur)
            data.copy(next, offset)
            vFiles.set(entry.path, next)
            sftp.status(reqid, STATUS_CODE.OK)
          })

          sftp.on('RENAME', (reqid, oldPath, newPath) => {
            const src = normPath(oldPath)
            const dst = normPath(newPath)
            const content = vFiles.get(src)
            if (!content) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE)
            vFiles.set(dst, content)
            vFiles.delete(src)
            sftp.status(reqid, STATUS_CODE.OK)
          })

          sftp.on('REMOVE', (reqid, p) => {
            vFiles.delete(normPath(p))
            sftp.status(reqid, STATUS_CODE.OK)
          })

          sftp.on('CLOSE', (reqid, handle) => {
            if (Buffer.isBuffer(handle) && handle.length >= 4) {
              openHandles.delete(handle.readUInt32BE(0))
            }
            sftp.status(reqid, STATUS_CODE.OK)
          })
        })
      })
    })
  })

  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const addr = server.address()
  return { server, port: typeof addr === 'object' && addr ? addr.port : 0, vFiles }
}

try {
  if (process.platform === 'win32' && existsSync(installerPath)) {
    assertExists(manifestPath, 'latest.yml')
    verifyUpdateYml({ distDir, expectedVersion: version })
    const installDir = join(tempInstallRoot, 'FerryApp')
    mkdirSync(join(installDir, 'locales'), { recursive: true })
    mkdirSync(join(installDir, 'resources'), { recursive: true })
    writeFileSync(join(installDir, 'Ferry.exe'), 'legacy-electron')
    writeFileSync(join(installDir, 'Uninstall Ferry.exe'), 'legacy-electron-uninstaller')
    writeFileSync(join(installDir, 'chrome_100_percent.pak'), 'legacy')
    writeFileSync(join(installDir, 'locales', 'en-US.pak'), 'legacy')
    writeFileSync(join(installDir, 'resources', 'app.asar'), 'legacy')

    // Run silent NSIS install over the simulated Electron directory (/D= must be unquoted and last).
    execFileSync(installerPath, ['/S', `/D=${installDir}`], { stdio: 'inherit' })
    ranNsisInstaller = true

    if (
      existsSync(join(installDir, 'Ferry.exe')) ||
      existsSync(join(installDir, 'Uninstall Ferry.exe')) ||
      existsSync(join(installDir, 'chrome_100_percent.pak')) ||
      existsSync(join(installDir, 'locales')) ||
      existsSync(join(installDir, 'resources'))
    ) {
      throw new Error('NSIS installer did not clean up legacy Electron runtime files in installDir')
    }
    assertExists(join(installDir, 'ferry-win_x64.exe'), 'Installed Neutralino binary')
    assertExists(join(installDir, 'resources.neu'), 'Installed Neutralino resources')
    assertExists(join(installDir, 'Uninstall.exe'), 'Installed NSIS uninstaller')
    assertExists(join(installDir, 'extensions', 'js.ferry.sidecar', 'node.exe'), 'Installed Node sidecar runtime')
    assertExists(join(installDir, 'extensions', 'js.ferry.sidecar', 'index.cjs'), 'Installed Node sidecar bundle')

    // Verify Neutralino -> Neutralino silent NSIS upgrade replaces existing Neutralino artifacts cleanly.
    writeFileSync(join(installDir, 'ferry-win_x64.exe'), 'stale-neutralino-exe')
    writeFileSync(join(installDir, 'resources.neu'), 'stale-neutralino-neu')
    writeFileSync(join(installDir, 'extensions', 'js.ferry.sidecar', 'index.cjs'), 'stale-neutralino-sidecar')
    execFileSync(installerPath, ['/S', `/D=${installDir}`], { stdio: 'inherit' })

    if (existsSync(join(installDir, '_ferry_upgrade_backup'))) {
      throw new Error('NSIS upgrade left behind _ferry_upgrade_backup directory')
    }
    for (const relPath of [
      'ferry-win_x64.exe',
      'resources.neu',
      join('extensions', 'js.ferry.sidecar', 'index.cjs')
    ]) {
      if (!readFileSync(join(installDir, relPath)).equals(readFileSync(join(protoDir, relPath)))) {
        throw new Error(`Neutralino -> Neutralino NSIS upgrade did not update ${relPath}`)
      }
    }

    runtimeDir = installDir
    console.log(`NSIS upgrade (Electron & Neutralino) smoke verified at ${installDir} (${statSync(installerPath).size} bytes installer).`)
  }

  const nodeBin = join(runtimeDir, 'extensions', 'js.ferry.sidecar', 'node.exe')
  const sidecarEntry = join(runtimeDir, 'extensions', 'js.ferry.sidecar', 'index.cjs')

  const startedSsh = await startSmokeSshServer()
  sshServer = startedSsh.server
  const sshPort = startedSsh.port
  const remoteFiles = startedSsh.vFiles

  wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise((r) => wss.once('listening', r))
  const address = wss.address()
  const port = typeof address === 'object' && address ? address.port : 0

  const startMs = performance.now()
  let readyMs = 0
  let stdoutBytes = 0
  let stderrText = ''
  let sidecarSocket = null
  const pendingReplies = new Map()
  const eventWaiters = []
  const bufferedEvents = []
  let nextReq = 1

  const dispatchRpcEvent = (channel, payload) => {
    for (let i = 0; i < eventWaiters.length; i++) {
      const w = eventWaiters[i]
      if (w.channel === channel && w.predicate(payload)) {
        eventWaiters.splice(i, 1)
        clearTimeout(w.timer)
        w.resolve(payload)
        return
      }
    }
    bufferedEvents.push({ channel, payload })
  }

  const readyPromise = new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => rejectReady(new Error('Sidecar did not emit sidecar:ready within 10s')), 10_000)
    wss.on('connection', (ws) => {
      sidecarSocket = ws
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString())
        if (msg.method === 'app.broadcast' && msg.data?.event === 'sidecar:ready') {
          readyMs = performance.now() - startMs
          clearTimeout(timeout)
          resolveReady()
          return
        }
        if (msg.method === 'app.broadcast' && msg.data?.event === 'rpc_reply') {
          const { id, result } = msg.data.data ?? {}
          const resolver = pendingReplies.get(id)
          if (resolver) {
            pendingReplies.delete(id)
            resolver(result)
          }
          return
        }
        if (msg.method === 'app.broadcast' && msg.data?.event === 'rpc_event') {
          const { channel, payload } = msg.data.data ?? {}
          if (typeof channel === 'string') {
            dispatchRpcEvent(channel, payload)
          }
        }
      })
    })
  })

  // Deliberately omit FERRY_APP_VERSION so smoke proves build-time version metadata is compiled in.
  const childEnv = { ...process.env, APPDATA: tempAppData }
  delete childEnv.FERRY_APP_VERSION

  child = spawn(nodeBin, [sidecarEntry, '--nl-mode'], {
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  child.stdout.on('data', (chunk) => {
    stdoutBytes += chunk.length
  })
  child.stderr.on('data', (chunk) => {
    stderrText += chunk.toString()
  })
  child.stdin.write(
    JSON.stringify({
      nlPort: port,
      nlToken: 'smoke-token',
      nlConnectToken: 'smoke-connect',
      nlExtensionId: 'js.ferry.sidecar'
    }) + '\n'
  )

  await readyPromise

  function rpcInvoke(channel, ...args) {
    const id = `smoke-${nextReq++}`
    return new Promise((resolveCall, rejectCall) => {
      const timer = setTimeout(() => {
        pendingReplies.delete(id)
        rejectCall(new Error(`Timed out waiting for ${channel}`))
      }, 10_000)
      pendingReplies.set(id, (res) => {
        clearTimeout(timer)
        resolveCall(res)
      })
      sidecarSocket.send(
        JSON.stringify({
          event: 'rpc_invoke',
          data: { id, channel, args }
        })
      )
    })
  }

  function rpcSend(channel, payload) {
    sidecarSocket.send(JSON.stringify({ event: 'rpc_send', data: { channel, payload } }))
  }

  function waitForEvent(channel, predicate = () => true, timeoutMs = 10_000) {
    const idx = bufferedEvents.findIndex((e) => e.channel === channel && predicate(e.payload))
    if (idx !== -1) {
      const [hit] = bufferedEvents.splice(idx, 1)
      return Promise.resolve(hit.payload)
    }
    return new Promise((resolveEvt, rejectEvt) => {
      const entry = {
        channel,
        predicate,
        resolve: resolveEvt,
        timer: setTimeout(() => {
          const i = eventWaiters.indexOf(entry)
          if (i !== -1) eventWaiters.splice(i, 1)
          rejectEvt(new Error(`Timed out waiting for event ${channel}`))
        }, timeoutMs)
      }
      eventWaiters.push(entry)
    })
  }

  const settingsRes = await rpcInvoke('settings:get')
  if (!settingsRes?.ok) throw new Error(`settings:get failed: ${JSON.stringify(settingsRes)}`)

  const createdSite = await rpcInvoke('sites:create', {
    name: 'Smoke Test Server',
    host: '127.0.0.1',
    port: sshPort,
    username: 'tester',
    authMethod: 'password',
    password: 'smoke-secret-password'
  })
  if (!createdSite?.ok) throw new Error(`sites:create failed: ${JSON.stringify(createdSite)}`)

  const sitesRes = await rpcInvoke('sites:list')
  if (!sitesRes?.ok || sitesRes.data?.length !== 1 || !sitesRes.data[0].hasPassword) {
    throw new Error(`sites:list DPAPI check failed: ${JSON.stringify(sitesRes)}`)
  }

  const keyPath = join(tempAppData, 'smoke_ed25519')
  const keyRes = await rpcInvoke('keys:generate', { keyPath })
  if (!keyRes?.ok || !existsSync(keyPath) || !existsSync(`${keyPath}.pub`)) {
    throw new Error(`keys:generate failed: ${JSON.stringify(keyRes)}`)
  }

  const fsListRes = await rpcInvoke('fs:local:list', tempAppData)
  if (!fsListRes?.ok || !Array.isArray(fsListRes.data?.entries)) {
    throw new Error(`fs:local:list failed: ${JSON.stringify(fsListRes)}`)
  }

  const dropRes = await rpcInvoke('fs:local:stage-drop', {
    entries: [
      { relativePath: 'drop-folder/hello.txt', isDir: false, data: { __b64: Buffer.from('staged-ok').toString('base64') } }
    ]
  })
  if (!dropRes?.ok || dropRes.data?.length !== 1 || !dropRes.data[0].isDir) {
    throw new Error(`fs:local:stage-drop failed: ${JSON.stringify(dropRes)}`)
  }
  const stagedFolder = dropRes.data[0].path
  const stagedFile = join(stagedFolder, 'hello.txt')

  const updateRes = await rpcInvoke('update:getStatus')
  if (!updateRes?.ok || updateRes.data?.currentVersion !== version) {
    throw new Error(`update:getStatus failed: ${JSON.stringify(updateRes)}`)
  }

  // Exercise live SSH/SFTP, file upload/download transfers, remote log tail, and interactive PTY via packaged sidecar.
  const sessionId = randomUUID()
  const hostKeyPromptPromise = waitForEvent('session:host-key-prompt', (p) => p?.sessionId === sessionId)
  const openSessionPromise = rpcInvoke('session:open', { sessionId, siteId: createdSite.data.id })
  const prompt = await hostKeyPromptPromise
  const trustRes = await rpcInvoke('session:host-key-respond', { requestId: prompt.requestId, accept: true })
  if (!trustRes?.ok) throw new Error(`session:host-key-respond failed: ${JSON.stringify(trustRes)}`)
  const openRes = await openSessionPromise
  if (!openRes?.ok || openRes.data?.status !== 'connected') {
    throw new Error(`session:open failed: ${JSON.stringify(openRes)}`)
  }

  const remoteListRes = await rpcInvoke('fs:remote:list', sessionId, '/home/tester', false)
  if (!remoteListRes?.ok || !remoteListRes.data?.entries?.some((e) => e.name === 'welcome.txt')) {
    throw new Error(`fs:remote:list failed: ${JSON.stringify(remoteListRes)}`)
  }

  const mkdirRes = await rpcInvoke('fs:remote:mkdir', sessionId, '/home/tester/uploads')
  if (!mkdirRes?.ok) throw new Error(`fs:remote:mkdir failed: ${JSON.stringify(mkdirRes)}`)

  const uploadPart = '/home/tester/uploads/staged.txt.part'
  remoteFiles.set(uploadPart, Buffer.from('existing remote file'))
  const uploadRes = await rpcInvoke('transfer:enqueue', {
    sessionId,
    kind: 'upload',
    localPath: stagedFile,
    remotePath: '/home/tester/uploads/staged.txt'
  })
  if (!uploadRes?.ok) throw new Error(`transfer:enqueue upload failed: ${JSON.stringify(uploadRes)}`)
  const uploadDone = await waitForEvent(
    'transfer:event',
    (e) => e?.transferId === uploadRes.data.transferId && e?.state === 'done'
  )
  if (!uploadDone || remoteFiles.get('/home/tester/uploads/staged.txt')?.toString('utf8') !== 'staged-ok') {
    throw new Error('Packaged SFTP upload content mismatch')
  }
  if (remoteFiles.get(uploadPart)?.toString('utf8') !== 'existing remote file' ||
      [...remoteFiles.keys()].some((p) => pathPosix.basename(p).startsWith('.ferry-transfer-'))) {
    throw new Error('Packaged SFTP upload did not preserve the existing .part or clean up staging')
  }
  if (existsSync(stagedFile)) {
    throw new Error(`Staged temp drop file was not cleaned up after upload: ${stagedFile}`)
  }

  const downloadTarget = join(tempAppData, 'downloaded-welcome.txt')
  writeFileSync(`${downloadTarget}.part`, 'existing local file')
  const downloadRes = await rpcInvoke('transfer:enqueue', {
    sessionId,
    kind: 'download',
    localPath: downloadTarget,
    remotePath: '/home/tester/welcome.txt'
  })
  if (!downloadRes?.ok) throw new Error(`transfer:enqueue download failed: ${JSON.stringify(downloadRes)}`)
  await waitForEvent('transfer:event', (e) => e?.transferId === downloadRes.data.transferId && e?.state === 'done')
  if (readFileSync(downloadTarget, 'utf8') !== 'hello from remote sftp\n') {
    throw new Error('Packaged SFTP download content mismatch')
  }
  if (readFileSync(`${downloadTarget}.part`, 'utf8') !== 'existing local file') {
    throw new Error('Packaged SFTP download did not preserve the existing .part')
  }

  const tailRes = await rpcInvoke('tail:start', {
    sessionId,
    remotePath: '/home/tester/app.log',
    historyLines: 20
  })
  if (!tailRes?.ok) throw new Error(`tail:start failed: ${JSON.stringify(tailRes)}`)
  const tailLine = await waitForEvent(
    'tail:line',
    (e) => e?.tailId === tailRes.data.tailId && String(e.line).includes('service started')
  )
  if (!tailLine) throw new Error('tail:line not received from packaged sidecar')
  await rpcInvoke('tail:stop', tailRes.data.tailId)

  const decodeTermData = (val) => {
    if (val && typeof val === 'object' && typeof val.__b64 === 'string') {
      return Buffer.from(val.__b64, 'base64').toString('utf8')
    }
    return String(val ?? '')
  }

  const termRes = await rpcInvoke('terminal:open', { sessionId, cols: 80, rows: 24 })
  if (!termRes?.ok) throw new Error(`terminal:open failed: ${JSON.stringify(termRes)}`)
  await waitForEvent(
    'terminal:data',
    (e) => e?.terminalId === termRes.data.terminalId && decodeTermData(e.data).includes('SMOKE_PTY_READY')
  )
  rpcSend('terminal:input', { terminalId: termRes.data.terminalId, data: 'echo smoke-pty-ok\r' })
  await waitForEvent(
    'terminal:data',
    (e) => e?.terminalId === termRes.data.terminalId && decodeTermData(e.data).includes('smoke-pty-ok')
  )
  await rpcInvoke('terminal:close', termRes.data.terminalId)
  await rpcInvoke('session:close', sessionId)

  const exitPromise = new Promise((resolveExit) => child.once('exit', resolveExit))
  sidecarSocket.send(JSON.stringify({ event: 'windowClose', data: {} }))
  child.stdin.end()
  const code = await exitPromise
  child = null
  await new Promise((r) => wss.close(r))
  wss = null
  await new Promise((r) => sshServer.close(r))
  sshServer = null

  if (stdoutBytes !== 0) {
    throw new Error(`Expected 0 stdout bytes in --nl-mode, got ${stdoutBytes}`)
  }
  console.log(
    `Packaged sidecar smoke passed in ${readyMs.toFixed(1)} ms (exit=${code ?? 'null'}, stderr=${stderrText.trim() || 'none'}).`
  )
} finally {
  if (child && child.exitCode === null) {
    const exitWait = new Promise((resolveExit) => child.once('exit', resolveExit))
    child.kill()
    await Promise.race([exitWait, new Promise((r) => setTimeout(r, 2000))])
  }
  if (wss) {
    try {
      await new Promise((r) => wss.close(r))
    } catch {
      // ignore
    }
  }
  if (sshServer) {
    try {
      await new Promise((r) => sshServer.close(r))
    } catch {
      // ignore
    }
  }
  if (ranNsisInstaller) {
    const uninstaller = join(runtimeDir, 'Uninstall.exe')
    if (existsSync(uninstaller)) {
      try {
        execFileSync(uninstaller, ['/S', `_?=${runtimeDir}`], { stdio: 'ignore' })
      } catch {
        // best-effort uninstall cleanup
      }
    }
  }
  try {
    rmSync(tempInstallRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // ignore OS handle release delay
  }
  try {
    rmSync(tempAppData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // ignore OS handle release delay
  }
}
