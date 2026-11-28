#!/usr/bin/env node
// Verifies the packaged macOS app: universal slices, signature, sandbox entitlements, and a real
// launch that renders the UI and answers sidecar RPC. Run after `node scripts/pack-macos.mjs`.
//   node scripts/smoke-macos-package.mjs [--app <path>] [--arch arm64|x86_64]
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = (flag, fallback) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback)
const app = resolve(root, argValue('--app', 'dist/macos/Ferry.app'))
const arch = argValue('--arch', '')
const exe = join(app, 'Contents', 'MacOS', 'Ferry')
const nodeBin = join(app, 'Contents', 'Resources', 'node')
const keychainService = `js.ferry.app.smoke.${process.pid}`

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`)
  if (!ok) failures.push(label)
}
const sh = (cmd, cmdArgs) => {
  try {
    return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
}

if (!existsSync(exe)) throw new Error(`Missing ${exe}; run scripts/pack-macos.mjs first`)

for (const [label, file] of [['shell', exe], ['node', nodeBin]]) {
  const archs = sh('lipo', ['-archs', file]).trim().split(/\s+/).sort().join(' ')
  check(`${label} is universal`, archs === 'arm64 x86_64', archs)
}
for (const rel of ['renderer/index.html', 'sidecar.cjs', 'Ferry.icns']) {
  check(`bundles ${rel}`, existsSync(join(app, 'Contents', 'Resources', rel)))
}
check('Info.plist has encryption declaration', sh('plutil', ['-extract', 'ITSAppUsesNonExemptEncryption', 'raw', join(app, 'Contents', 'Info.plist')]).trim() === 'false')

const verify = sh('codesign', ['--verify', '--strict', '--verbose=2', app])
check('app signature verifies (strict)', !/invalid|not valid|modified|a sealed resource is missing/i.test(verify), verify.trim().split('\n').pop())

const parentEnt = sh('codesign', ['-d', '--entitlements', '-', '--xml', app])
for (const key of ['app-sandbox', 'network.client', 'files.user-selected.read-write', 'files.bookmarks.app-scope']) {
  check(`app entitlement ${key}`, parentEnt.includes(`com.apple.security.${key}`))
}
check('app has no network.server', !parentEnt.includes('network.server'))
const childEnt = sh('codesign', ['-d', '--entitlements', '-', '--xml', nodeBin])
check('node inherits the sandbox', childEnt.includes('app-sandbox') && childEnt.includes('inherit'))
check('node has no extra entitlements', !childEnt.includes('network.client') && !childEnt.includes('files.'))

// Launch for real: the shell reports what the page rendered and whether sidecar RPC answers.
const cmd = arch ? '/usr/bin/arch' : exe
const cmdArgs = arch ? [`-${arch}`, exe] : []
const result = await new Promise((resolveRun) => {
  const child = spawn(cmd, cmdArgs, {
    env: { ...process.env, FERRY_SELFTEST: '1', FERRY_KEYCHAIN_SERVICE: keychainService },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let log = ''
  const finish = (value) => {
    clearTimeout(timer)
    child.kill()
    resolveRun(value)
  }
  const timer = setTimeout(() => finish({ ok: false, log }), 60_000)
  const onData = (d) => {
    log += d
    const m = log.match(/SELFTEST success\((.*)\)\n/s)
    if (m) finish({ ok: true, log, payload: m[1] })
  }
  child.stderr.on('data', onData)
  child.stdout.on('data', onData)
  child.on('exit', () => finish({ ok: false, log }))
})
sh('security', ['delete-generic-password', '-s', keychainService])
sh('pkill', ['-f', join(app, 'Contents/Resources/node')])

check(`launches${arch ? ` as ${arch}` : ''} and runs the self-test`, result.ok, result.ok ? '' : result.log.slice(-200))
if (result.ok) {
  const payload = result.payload
  check('renderer exposes window.api', payload.includes('"api":"object"'))
  check('UI rendered', /Sites|New Tab/.test(payload))
  check('sidecar RPC answered (fs:local:list)', payload.includes('\\"ok\\":true'))
  check('updates reported as store-managed', payload.includes('the Mac App Store'))
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nmacOS package smoke test passed')
