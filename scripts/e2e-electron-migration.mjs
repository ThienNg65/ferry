import { createHash } from 'crypto'
import { execFileSync, spawn, spawnSync } from 'child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import http from 'http'
import * as os from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

if (process.platform !== 'win32') {
  console.log('Skipping Windows Electron -> Neutralino E2E migration test on non-Windows platform.')
  process.exit(0)
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const distDir = join(rootDir, 'dist')
const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
const version = String(pkg.version || '0.24.0')
const neutralinoInstaller = join(distDir, `Ferry-Setup-${version}.exe`)

if (!existsSync(neutralinoInstaller)) {
  throw new Error(`Missing packaged Neutralino installer: ${neutralinoInstaller}. Run "npm run package" first.`)
}

const ELECTRON_V0231_URL =
  'https://github.com/ThienNg65/ferry-release/releases/download/ferry-v0.23.1/Ferry-Setup-0.23.1.exe'

function runPs(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8'
  }).trim()
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// ---------------------------------------------------------------------------
// 1. Fault-Injection Tests: Locked-file rollback & pre-existing backup preservation
// ---------------------------------------------------------------------------
console.log('=== [1/3] Fault-injection: locked-file rollback ===')
{
  const dir = mkdtempSync(join(os.tmpdir(), 'ferry-rollback-lock-'))
  let locker = null
  try {
    mkdirSync(join(dir, 'locales'), { recursive: true })
    mkdirSync(join(dir, 'resources'), { recursive: true })
    writeFileSync(join(dir, 'Ferry.exe'), 'original-electron-exe')
    writeFileSync(join(dir, 'Uninstall Ferry.exe'), 'original-uninstaller')
    writeFileSync(join(dir, 'resources', 'app.asar'), 'original-asar')
    writeFileSync(join(dir, 'locales', 'en-US.pak'), 'locked-pak')

    // Hold an exclusive OS file lock on locales\en-US.pak so BackupDir("locales") fails.
    const lockPath = join(dir, 'locales', 'en-US.pak').replace(/'/g, "''")
    locker = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `$fs = [IO.File]::Open('${lockPath}', 'Open', 'ReadWrite', 'None'); Write-Output 'LOCKED'; Start-Sleep -Seconds 30; $fs.Close()`
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] }
    )
    await new Promise((resolveLock, rejectLock) => {
      const timer = setTimeout(() => rejectLock(new Error('File locker did not start')), 5000)
      locker.stdout.on('data', (d) => {
        if (d.toString().includes('LOCKED')) {
          clearTimeout(timer)
          resolveLock()
        }
      })
    })

    const res = spawnSync(neutralinoInstaller, ['/S', `/D=${dir}`], { encoding: 'utf8' })
    assert(res.status !== 0, `Expected installer to fail on locked file, got exit ${res.status}`)
    assert(readFileSync(join(dir, 'Ferry.exe'), 'utf8') === 'original-electron-exe', 'Ferry.exe was not restored after rollback')
    assert(readFileSync(join(dir, 'resources', 'app.asar'), 'utf8') === 'original-asar', 'app.asar was not restored after rollback')
    assert(!existsSync(join(dir, '_ferry_upgrade_backup')), '_ferry_upgrade_backup was not cleaned up after rollback')
    console.log('  PASS: locked-file rollback restored previous installation.')
  } finally {
    if (locker && locker.exitCode === null) {
      const exited = new Promise((r) => locker.once('exit', r))
      locker.kill()
      await exited
    }
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log('=== [2/3] Fault-injection: pre-existing interrupted backup preservation ===')
{
  const dir = mkdtempSync(join(os.tmpdir(), 'ferry-rollback-crash-'))
  let locker = null
  try {
    mkdirSync(join(dir, '_ferry_upgrade_backup', 'resources'), { recursive: true })
    mkdirSync(join(dir, 'locales'), { recursive: true })
    writeFileSync(join(dir, '_ferry_upgrade_backup', 'Ferry.exe'), 'intact-pre-crash-backup')
    writeFileSync(join(dir, '_ferry_upgrade_backup', 'resources', 'app.asar'), 'intact-pre-crash-asar')
    writeFileSync(join(dir, 'locales', 'en-US.pak'), 'locked-pak')

    const lockPath = join(dir, 'locales', 'en-US.pak').replace(/'/g, "''")
    locker = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `$fs = [IO.File]::Open('${lockPath}', 'Open', 'ReadWrite', 'None'); Write-Output 'LOCKED'; Start-Sleep -Seconds 30; $fs.Close()`
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] }
    )
    await new Promise((resolveLock, rejectLock) => {
      const timer = setTimeout(() => rejectLock(new Error('File locker did not start')), 5000)
      locker.stdout.on('data', (d) => {
        if (d.toString().includes('LOCKED')) {
          clearTimeout(timer)
          resolveLock()
        }
      })
    })

    const res = spawnSync(neutralinoInstaller, ['/S', `/D=${dir}`], { encoding: 'utf8' })
    assert(res.status !== 0, `Expected installer retry to fail on locked file, got exit ${res.status}`)
    assert(
      readFileSync(join(dir, 'Ferry.exe'), 'utf8') === 'intact-pre-crash-backup',
      'Pre-existing _ferry_upgrade_backup was overwritten instead of preserved/restored'
    )
    console.log('  PASS: pre-existing interrupted backup was preserved and restored.')
  } finally {
    if (locker && locker.exitCode === null) {
      const exited = new Promise((r) => locker.once('exit', r))
      locker.kill()
      await exited
    }
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// 3. Real v0.23.1 Electron -> electron-updater -> Neutralino E2E Migration
// ---------------------------------------------------------------------------
console.log('=== [3/3] Real v0.23.1 Electron -> electron-updater -> Neutralino E2E ===')
const electronInstaller =
  process.env.FERRY_ELECTRON_INSTALLER || join(os.tmpdir(), 'ferry-v0.23.1-electron-setup.exe')

if (!existsSync(electronInstaller)) {
  console.log(`Downloading real v0.23.1 Electron installer from ${ELECTRON_V0231_URL}...`)
  const resp = await fetch(ELECTRON_V0231_URL)
  if (!resp.ok) throw new Error(`Failed to download ${ELECTRON_V0231_URL}: ${resp.status}`)
  writeFileSync(electronInstaller, Buffer.from(await resp.arrayBuffer()))
}

const appDataDir = join(process.env.APPDATA || join(os.homedir(), 'AppData', 'Roaming'), 'Ferry')
const appDataBackup = existsSync(appDataDir) ? `${appDataDir}.e2e-backup-${Date.now()}` : null
const customDir = mkdtempSync(join(os.tmpdir(), 'ferry-e2e-real-'))
let httpServer = null

try {
  if (appDataBackup) {
    cpSync(appDataDir, appDataBackup, { recursive: true })
    rmSync(appDataDir, { recursive: true, force: true })
  }

  // Seed DPAPI Local State + encrypted site + known_hosts in %APPDATA%\Ferry
  mkdirSync(appDataDir, { recursive: true })
  const dpapiOut = runPs(`
    Add-Type -AssemblyName System.Security
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $key = New-Object byte[] 32
    $rng.GetBytes($key)
    $enc = [Security.Cryptography.ProtectedData]::Protect($key, $null, 'CurrentUser')
    $prefix = [System.Text.Encoding]::ASCII.GetBytes('DPAPI')
    $combined = New-Object byte[] ($prefix.Length + $enc.Length)
    [Array]::Copy($prefix, 0, $combined, 0, $prefix.Length)
    [Array]::Copy($enc, 0, $combined, $prefix.Length, $enc.Length)
    Write-Output ([Convert]::ToBase64String($key))
    Write-Output ([Convert]::ToBase64String($combined))
  `).split(/\r?\n/)
  const rawKey = Buffer.from(dpapiOut[0].trim(), 'base64')
  const wrappedKeyB64 = dpapiOut[1].trim()

  const { createCipheriv, randomBytes } = await import('crypto')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', rawKey, iv)
  const ct = Buffer.concat([cipher.update('e2e-secret-password', 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const v10Secret = Buffer.concat([Buffer.from('v10'), iv, ct, tag]).toString('base64')

  writeFileSync(join(appDataDir, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: wrappedKeyB64 } }))
  writeFileSync(
    join(appDataDir, 'sites.json'),
    JSON.stringify({
      sites: [
        {
          id: 'e2e-site',
          name: 'E2E Server',
          host: 'e2e.example.com',
          port: 22,
          username: 'tester',
          authMethod: 'password',
          secretPassword: v10Secret,
          createdAt: '2026-11-14T00:00:00.000Z',
          updatedAt: '2026-11-14T00:00:00.000Z'
        }
      ]
    })
  )
  writeFileSync(
    join(appDataDir, 'known_hosts.json'),
    JSON.stringify({ hosts: { 'e2e.example.com:22': 'SHA256:e2etestfingerprint' } })
  )

  // Install real v0.23.1 Electron into custom directory
  const instElectron = spawnSync(electronInstaller, ['/S', `/D=${customDir}`], { encoding: 'utf8' })
  assert(instElectron.status === 0, `Electron installer failed: ${instElectron.status}`)
  assert(existsSync(join(customDir, 'Ferry.exe')), 'Electron Ferry.exe missing')

  // Start local HTTP update feed serving canonical latest.yml (with target version 0.24.0) + Ferry-Setup-*.exe
  const nlBuf = readFileSync(neutralinoInstaller)
  const nlSha512 = createHash('sha512').update(nlBuf).digest('base64')
  const nlExeName = `Ferry-Setup-${version}.exe`
  const feedManifest = `version: 0.24.0\nfiles:\n  - url: ${nlExeName}\n    sha512: ${nlSha512}\n    size: ${nlBuf.length}\npath: ${nlExeName}\nsha512: ${nlSha512}\nreleaseDate: '${new Date().toISOString()}'\n`

  let manifestRequested = false
  let installerDownloaded = false
  httpServer = http.createServer((req, res) => {
    const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname
    if (pathname === '/latest.yml') {
      manifestRequested = true
      res.writeHead(200, { 'Content-Type': 'text/yaml' })
      res.end(feedManifest)
    } else if (pathname === `/${nlExeName}`) {
      installerDownloaded = true
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(nlBuf.length) })
      res.end(nlBuf)
    } else {
      res.writeHead(404)
      res.end('Not found')
    }
  })
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r))
  const feedPort = httpServer.address().port

  // Point the installed Electron app's app-update.yml to our local generic feed
  writeFileSync(
    join(customDir, 'resources', 'app-update.yml'),
    `provider: generic\nurl: http://127.0.0.1:${feedPort}\nupdaterCacheDirName: ferry-updater\n`,
    'utf8'
  )

  // Launch real Electron Ferry.exe and wait for its bundled electron-updater to fetch latest.yml + download installer
  const electronChild = spawn(join(customDir, 'Ferry.exe'), [], { detached: true, stdio: 'ignore' })
  electronChild.unref()

  const dlDeadline = Date.now() + 30_000
  while ((!manifestRequested || !installerDownloaded) && Date.now() < dlDeadline) {
    await new Promise((r) => setTimeout(r, 500))
  }
  assert(manifestRequested, 'Real Electron electron-updater did not request /latest.yml')
  assert(installerDownloaded, `Real Electron electron-updater did not download /${nlExeName}`)
  console.log('  PASS: real Electron electron-updater fetched latest.yml and downloaded Neutralino installer.')

  // Run Neutralino installer with --updated /S --force-run (NO /D=, testing .onInit custom-dir discovery)
  const nlChild = spawn(neutralinoInstaller, ['--updated', '/S', '--force-run'], { stdio: 'ignore' })
  await new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => rejectExit(new Error('Neutralino installer timed out')), 60_000)
    nlChild.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolveExit()
      else rejectExit(new Error(`Neutralino installer exited with ${code}`))
    })
  })

  await new Promise((r) => setTimeout(r, 2000))

  // Verify Neutralino + Node sidecar are running and Electron is gone
  const procCheck = runPs(`
    $nl = Get-Process -Name 'ferry-win_x64' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith('${customDir.replace(/'/g, "''")}', [StringComparison]::OrdinalIgnoreCase) }
    $sc = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${customDir.replace(/'/g, "''")}', [StringComparison]::OrdinalIgnoreCase) }
    if (-not $nl) { throw 'Neutralino ferry-win_x64.exe did not launch' }
    if (-not $sc) { throw 'Node sidecar did not launch' }
    $nl | Stop-Process -Force -ErrorAction SilentlyContinue
    $sc | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Output "OK"
  `)
  assert(procCheck.includes('OK'), 'Neutralino process verification failed')

  assert(!existsSync(join(customDir, 'Ferry.exe')), 'Electron Ferry.exe still exists')
  assert(!existsSync(join(customDir, 'Uninstall Ferry.exe')), 'Electron Uninstall Ferry.exe still exists')
  assert(!existsSync(join(customDir, 'resources', 'app.asar')), 'Electron app.asar still exists')
  assert(existsSync(join(customDir, 'ferry-win_x64.exe')), 'Neutralino ferry-win_x64.exe missing')

  // Verify single Uninstall entry
  const uninstallCount = runPs(`
    $keys = @(Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -like 'Ferry*' })
    Write-Output "$($keys.Count):$($keys.PSChildName -join ',')"
  `)
  assert(uninstallCount === '1:Ferry', `Expected exactly 1 Uninstall entry (1:Ferry), got ${uninstallCount}`)

  // Verify %APPDATA%\Ferry DPAPI secret and known_hosts preserved
  const preservedSites = JSON.parse(readFileSync(join(appDataDir, 'sites.json'), 'utf8'))
  assert(preservedSites.sites[0].secretPassword === v10Secret, 'DPAPI secret in sites.json was altered')
  const preservedHosts = JSON.parse(readFileSync(join(appDataDir, 'known_hosts.json'), 'utf8'))
  assert(preservedHosts.hosts['e2e.example.com:22'] === 'SHA256:e2etestfingerprint', 'known_hosts.json was altered')
  console.log('  PASS: custom-dir migration, single Uninstall entry, Neutralino launch, and DPAPI data preservation verified.')

  // Clean uninstall
  const uninst = spawnSync(join(customDir, 'Uninstall.exe'), ['/S'], { encoding: 'utf8' })
  assert(uninst.status === 0, `Uninstaller failed: ${uninst.status}`)
} finally {
  httpServer?.close()
  try {
    runPs(
      `Get-Process -Name 'Ferry','ferry-win_x64' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith('${customDir.replace(/'/g, "''")}', [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue; exit 0`
    )
  } catch {
    // ignore cleanup errors
  }
  rmSync(customDir, { recursive: true, force: true })
  if (appDataBackup && existsSync(appDataBackup)) {
    rmSync(appDataDir, { recursive: true, force: true })
    cpSync(appDataBackup, appDataDir, { recursive: true })
    rmSync(appDataBackup, { recursive: true, force: true })
  }
}

console.log('ALL E2E MIGRATION & ROLLBACK GATES PASSED!')
