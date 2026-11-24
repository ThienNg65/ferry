import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

function parseSemver(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/)
  assert.ok(match, `Expected exact X.Y.Z Node version, got ${JSON.stringify(version)}`)
  return match.slice(1).map(Number)
}

function isAtLeast([majA, minA, patA], [majB, minB, patB]) {
  if (majA !== majB) return majA > majB
  if (minA !== minB) return minA > minB
  return patA >= patB
}

test('CI and release workflows pin the same supported Node 22 release', async () => {
  const actionYml = await readFile(new URL('../actions/setup-node-deps/action.yml', import.meta.url), 'utf8')
  const releaseYml = await readFile(new URL('../workflows/release.yml', import.meta.url), 'utf8')
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
  const claudeMd = await readFile(new URL('../../CLAUDE.md', import.meta.url), 'utf8')

  const actionMatch = actionYml.match(/^\s*node-version:\s*['"]?(\d+\.\d+\.\d+)['"]?\s*$/m)
  assert.ok(actionMatch, 'Missing pinned node-version in .github/actions/setup-node-deps/action.yml')
  const pinnedVersion = actionMatch[1]
  const parsed = parseSemver(pinnedVersion)
  assert.equal(parsed[0], 22, `Expected Node 22 LTS pin, got ${pinnedVersion}`)
  assert.equal(
    isAtLeast(parsed, [22, 22, 2]),
    true,
    `Pinned Node ${pinnedVersion} must be >= 22.22.2 to satisfy dependency engines`
  )

  const releaseMatches = [...releaseYml.matchAll(/^\s*node-version:\s*['"]?(\d+\.\d+\.\d+)['"]?\s*$/gm)]
  assert.ok(releaseMatches.length > 0, 'Expected explicit node-version pin in release.yml')
  for (const match of releaseMatches) {
    assert.equal(match[1], pinnedVersion, 'release.yml node-version must stay aligned with setup-node-deps')
  }

  assert.equal(pkg.engines?.node, '>=22.22.2')
  assert.match(claudeMd, new RegExp(`Node v${pinnedVersion.replace(/\./g, '\\.')}\\b`))
})
