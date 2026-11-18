import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import updaterTool from './regenerate-update-yml.js'

const { regenerateUpdateYml, verifyUpdateYml } = updaterTool

let tmpDir

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ferry-regen-yml-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('regenerates latest.yml with matching sha512/size and removes stale blockmaps', () => {
  const bytes = Buffer.from('MZ-signed-ferry-installer-binary')
  fs.writeFileSync(path.join(tmpDir, 'Ferry-Setup-0.29.1.exe'), bytes)
  fs.writeFileSync(path.join(tmpDir, 'Ferry-Setup-0.29.1.exe.blockmap'), 'stale-blockmap')

  const result = regenerateUpdateYml({
    distDir: tmpDir,
    version: '0.29.1',
    releaseDate: '2026-11-18T00:00:00.000Z'
  })

  const expectedSha = crypto.createHash('sha512').update(bytes).digest('base64')
  assert.equal(result.exeName, 'Ferry-Setup-0.29.1.exe')
  assert.equal(result.sha512, expectedSha)
  assert.equal(result.size, bytes.length)
  assert.equal(fs.existsSync(path.join(tmpDir, 'Ferry-Setup-0.29.1.exe.blockmap')), false)

  const verified = verifyUpdateYml({ distDir: tmpDir, expectedVersion: '0.29.1' })
  assert.equal(verified.sha512, expectedSha)
  assert.equal(verified.size, bytes.length)

  // CRLF line endings should also verify cleanly
  const crlf = fs.readFileSync(path.join(tmpDir, 'latest.yml'), 'utf8').replace(/\n/g, '\r\n')
  fs.writeFileSync(path.join(tmpDir, 'latest.yml'), crlf, 'utf8')
  assert.equal(verifyUpdateYml({ distDir: tmpDir, expectedVersion: '0.29.1' }).size, bytes.length)
})

test('fails fast when installer is missing, ambiguous, or version-mismatched', () => {
  assert.throws(
    () => regenerateUpdateYml({ distDir: tmpDir, version: '0.29.1' }),
    /no Ferry-Setup-\*\.exe found/
  )

  fs.writeFileSync(path.join(tmpDir, 'Ferry-Setup-0.29.0.exe'), 'old')
  assert.throws(
    () => regenerateUpdateYml({ distDir: tmpDir, version: '0.29.1' }),
    /expected Ferry-Setup-0\.29\.1\.exe.*found Ferry-Setup-0\.29\.0\.exe/
  )

  fs.writeFileSync(path.join(tmpDir, 'Ferry-Setup-0.29.1.exe'), 'new')
  assert.throws(
    () => regenerateUpdateYml({ distDir: tmpDir, version: '0.29.1' }),
    /expected exactly 1 Ferry-Setup-\*\.exe/
  )
})

test('verifyUpdateYml detects tampered installer bytes or mismatched latest.yml fields', () => {
  const original = Buffer.from('MZ-original-signed')
  fs.writeFileSync(path.join(tmpDir, 'Ferry-Setup-0.29.1.exe'), original)
  regenerateUpdateYml({ distDir: tmpDir, version: '0.29.1' })

  fs.writeFileSync(path.join(tmpDir, 'Ferry-Setup-0.29.1.exe'), Buffer.from('MZ-tampered-signed'))
  assert.throws(
    () => verifyUpdateYml({ distDir: tmpDir, expectedVersion: '0.29.1' }),
    /sha512 does not match|size/
  )

  fs.writeFileSync(path.join(tmpDir, 'Ferry-Setup-0.29.1.exe'), original)
  const badYml = fs.readFileSync(path.join(tmpDir, 'latest.yml'), 'utf8').replace('version: 0.29.1', 'version: 0.28.0')
  fs.writeFileSync(path.join(tmpDir, 'latest.yml'), badYml, 'utf8')
  assert.throws(
    () => verifyUpdateYml({ distDir: tmpDir, expectedVersion: '0.29.1' }),
    /version "0\.28\.0" !== expected "0\.29\.1"/
  )
})
