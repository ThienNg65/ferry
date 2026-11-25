import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

function readJson(relPath) {
  return JSON.parse(readFileSync(resolve(rootDir, relPath), 'utf8'))
}

test('VERSION, package.json, package-lock.json, neutralino.config.json, and release-please manifest stay synchronized', () => {
  const pkg = readJson('package.json')
  const lock = readJson('package-lock.json')
  const neutralino = readJson('neutralino.config.json')
  const manifest = readJson('.release-please-manifest.json')
  const rpConfig = readJson('release-please-config.json')
  const versionFile = readFileSync(resolve(rootDir, 'VERSION'), 'utf8').trim()

  assert.equal(lock.version, pkg.version, 'package-lock.json version must match package.json')
  assert.equal(neutralino.version, pkg.version, 'neutralino.config.json version must match package.json')
  assert.equal(manifest['.'], pkg.version, '.release-please-manifest.json["."] must match package.json')
  assert.equal(versionFile, pkg.version, 'VERSION file must match package.json')

  const extraFiles = rpConfig.packages['.']['extra-files']
  assert.ok(extraFiles.includes('VERSION'), 'release-please-config.json extra-files must include VERSION')
  assert.ok(
    extraFiles.some((entry) => typeof entry === 'object' && entry !== null && entry.path === 'neutralino.config.json'),
    'release-please-config.json extra-files must include neutralino.config.json'
  )
})
