#!/usr/bin/env node
// Exercises the external HTTPS bridge inside the packaged, sandboxed macOS app.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const app = resolve(root, 'dist/macos/Ferry.app')
const exe = join(app, 'Contents', 'MacOS', 'Ferry')
const nodeBin = join(app, 'Contents', 'Resources', 'node')
const keychainService = `js.ferry.external-url.smoke.${process.pid}`

if (!existsSync(exe)) {
  throw new Error(`Missing ${exe}; run npm run pack:macos first`)
}

const selfTestJs = `return (async () => {
  const result = { api: typeof window.api }
  try {
    await window.api.openExternal('https://example.com/')
    result.opened = true
  } catch (error) {
    result.openError = String(error)
  }
  return JSON.stringify(result)
})()`

const result = await new Promise((resolveRun) => {
  const child = spawn(exe, [], {
    env: {
      ...process.env,
      FERRY_SELFTEST: '1',
      FERRY_SELFTEST_JS: selfTestJs,
      FERRY_KEYCHAIN_SERVICE: keychainService
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let log = ''
  let settled = false
  const finish = (value) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    child.kill()
    resolveRun(value)
  }
  const timer = setTimeout(() => finish({ ok: false, log }), 60_000)
  const onData = (data) => {
    log += data
    const match = log.match(/SELFTEST success\((.*)\)\r?\n/s)
    if (match) finish({ ok: true, log, payload: match[1] })
  }
  child.stderr.on('data', onData)
  child.stdout.on('data', onData)
  child.on('error', (error) => finish({ ok: false, log: `${log}\n${error}` }))
  child.on('exit', () => finish({ ok: false, log }))
})

try {
  execFileSync('security', ['delete-generic-password', '-s', keychainService], { stdio: 'ignore' })
} catch {}
try {
  execFileSync('pkill', ['-f', nodeBin], { stdio: 'ignore' })
} catch {}

if (!result.ok) {
  console.error(result.log.slice(-4000))
  throw new Error('Packaged macOS app did not complete its external URL self-test')
}

let payload
try {
  const decoded = JSON.parse(result.payload)
  payload = typeof decoded === 'string' ? JSON.parse(decoded) : decoded
} catch (error) {
  throw new Error(`Invalid external URL self-test payload: ${error}\n${result.payload}`)
}

if (payload.api !== 'object') {
  throw new Error('Packaged renderer did not expose window.api')
}
if (payload.opened !== true) {
  throw new Error(`Native HTTPS URL opening failed: ${payload.openError ?? 'no success result'}`)
}

console.log('PASS  packaged macOS WKWebView opened an HTTPS URL through Launch Services')
