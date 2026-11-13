import { execFileSync, spawn } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import * as os from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { WebSocketServer } from 'ws'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const distDir = join(rootDir, 'dist')
const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
const version = String(pkg.version || '0.22.0')

const protoDir = join(distDir, 'ferry-neutralino-win_x64')
const zipPath = join(distDir, `Ferry-Neutralino-${version}-win-x64.zip`)
const installerPath = join(distDir, `Ferry-Neutralino-Setup-${version}.exe`)
const manifestPath = join(distDir, 'latest-neutralino.yml')

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

const tempInstallRoot = mkdtempSync(join(os.tmpdir(), 'ferry-smoke-install-'))
const tempAppData = mkdtempSync(join(os.tmpdir(), 'ferry-smoke-appdata-'))
let runtimeDir = protoDir
let ranNsisInstaller = false
let child = null
let wss = null

try {
  if (process.platform === 'win32' && existsSync(installerPath)) {
    assertExists(manifestPath, 'latest-neutralino.yml')
    const installDir = join(tempInstallRoot, 'FerryApp')
    mkdirSync(join(installDir, 'locales'), { recursive: true })
    mkdirSync(join(installDir, 'resources'), { recursive: true })
    writeFileSync(join(installDir, 'Ferry.exe'), 'legacy-electron')
    writeFileSync(join(installDir, 'chrome_100_percent.pak'), 'legacy')
    writeFileSync(join(installDir, 'locales', 'en-US.pak'), 'legacy')
    writeFileSync(join(installDir, 'resources', 'app.asar'), 'legacy')

    // Run silent NSIS install over the simulated Electron directory (/D= must be unquoted and last).
    execFileSync(installerPath, ['/S', `/D=${installDir}`], { stdio: 'inherit' })
    ranNsisInstaller = true

    if (
      existsSync(join(installDir, 'Ferry.exe')) ||
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
    runtimeDir = installDir
    console.log(`NSIS upgrade & install smoke verified at ${installDir} (${statSync(installerPath).size} bytes installer).`)
  }

  const nodeBin = join(runtimeDir, 'extensions', 'js.ferry.sidecar', 'node.exe')
  const sidecarEntry = join(runtimeDir, 'extensions', 'js.ferry.sidecar', 'index.cjs')

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
  let nextReq = 1

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
        }
      })
    })
  })

  child = spawn(nodeBin, [sidecarEntry, '--nl-mode'], {
    env: { ...process.env, APPDATA: tempAppData, FERRY_APP_VERSION: version },
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

  const settingsRes = await rpcInvoke('settings:get')
  if (!settingsRes?.ok) throw new Error(`settings:get failed: ${JSON.stringify(settingsRes)}`)

  const createdSite = await rpcInvoke('sites:create', {
    name: 'Smoke Test Server',
    host: 'smoke.example.com',
    port: 22,
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

  const updateRes = await rpcInvoke('update:getStatus')
  if (!updateRes?.ok || updateRes.data?.currentVersion !== version) {
    throw new Error(`update:getStatus failed: ${JSON.stringify(updateRes)}`)
  }

  const exitPromise = new Promise((resolveExit) => child.once('exit', resolveExit))
  sidecarSocket.send(JSON.stringify({ event: 'windowClose', data: {} }))
  child.stdin.end()
  const code = await exitPromise
  child = null
  await new Promise((r) => wss.close(r))
  wss = null

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
