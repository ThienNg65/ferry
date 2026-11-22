import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const workflowUrl = new URL('../workflows/release.yml', import.meta.url)
const workflow = await readFile(workflowUrl, 'utf8')
const lines = workflow.split(/\r?\n/)

function indentation(line) {
  return line.match(/^ */)?.[0].length ?? 0
}

function blockAfter(sourceLines, startIndex, parentIndent) {
  let end = sourceLines.length
  for (let index = startIndex + 1; index < sourceLines.length; index += 1) {
    const line = sourceLines[index]
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (indentation(line) <= parentIndent) {
      end = index
      break
    }
  }
  return sourceLines.slice(startIndex + 1, end)
}

function findBlock(sourceLines, header, indent) {
  const expected = `${' '.repeat(indent)}${header}:`
  const start = sourceLines.findIndex(line => line === expected)
  if (start === -1) return []
  return blockAfter(sourceLines, start, indent)
}

function job(name) {
  const start = lines.findIndex(line => line === `  ${name}:`)
  assert.notEqual(start, -1, `Missing release job: ${name}`)
  return [lines[start], ...blockAfter(lines, start, 2)]
}

function step(jobLines, name) {
  const start = jobLines.findIndex(line => line === `      - name: ${name}`)
  assert.notEqual(start, -1, `Missing workflow step: ${name}`)
  return [jobLines[start], ...blockAfter(jobLines, start, 6)]
}

function stepUsing(jobLines, action) {
  const start = jobLines.findIndex(line => line === `      - uses: ${action}`)
  assert.notEqual(start, -1, `Missing workflow action: ${action}`)
  return [jobLines[start], ...blockAfter(jobLines, start, 6)]
}

function stepEnv(stepLines) {
  return findBlock(stepLines, 'env', 8)
}

function assertNoReleaseCredentials(envLines, context) {
  assert.doesNotMatch(
    envLines.join('\n'),
    /^\s*(?:GH_TOKEN|PUBLIC_RELEASE_TOKEN|SOURCE_RELEASE_TOKEN|SIGNPATH_API_TOKEN|LEGACY_TOKEN):/m,
    `${context} must not inherit release credentials`
  )
}

test('release jobs do not expose publishing credentials at job scope', () => {
  for (const name of ['sync-public-readme', 'publish-assets']) {
    const env = findBlock(job(name), 'env', 4)
    assertNoReleaseCredentials(env, `${name} job environment`)
  }
})

test('public repository visibility checks use an unauthenticated read', () => {
  for (const name of ['sync-public-readme', 'publish-assets']) {
    const verify = step(job(name), 'Verify public publishing access')
    assertNoReleaseCredentials(stepEnv(verify), `${name} visibility check`)
    assert.match(verify.join('\n'), /curl --fail --silent --show-error/)
    assert.match(verify.join('\n'), /https:\/\/api\.github\.com\/repos\//)
    assert.match(verify.join('\n'), /\.visibility/)
    assert.doesNotMatch(verify.join('\n'), /gh api/)
  }
})

test('README sync receives the public token only in its publishing step', () => {
  const readmeJob = job('sync-public-readme')
  for (const action of ['actions/checkout@v4', 'actions/setup-node@v4', './.github/actions/setup-node-deps']) {
    assertNoReleaseCredentials(stepUsing(readmeJob, action), `${action} in sync-public-readme`)
  }

  const sync = step(readmeJob, 'Sync public README template')
  assert.match(stepEnv(sync).join('\n'), /^\s+PUBLIC_RELEASE_TOKEN: \$\{\{ secrets\.PUBLIC_RELEASE_TOKEN \}\}$/m)
  assert.doesNotMatch(stepEnv(sync).join('\n'), /^\s+GH_TOKEN:/m)
})

test('release build and tests do not receive the public token', () => {
  const publishJob = job('publish-assets')
  const untrustedSteps = [
    'Resolve release target',
    'Verify checked-out release tag commit',
    'Verify public publishing access',
    'Verify package version matches release tag',
    'Typecheck release commit',
    'Run release regression tests',
    'Test release automation scripts',
    'Install and verify NSIS compiler',
    'Build and Package Neutralino',
    'Smoke test Neutralino package',
    'Upload unsigned installer for signing',
    'Submit signing request to SignPath',
    'Regenerate update metadata for signed binary',
    'Verify complete installer and update metadata',
    'Generate WinGet manifests',
    'Upload WinGet manifests',
    'Trigger website rebuild'
  ]

  for (const name of untrustedSteps) {
    const current = step(publishJob, name)
    assertNoReleaseCredentials(stepEnv(current), `${name} step`)
  }

  assertNoReleaseCredentials(
    stepUsing(publishJob, './.github/actions/setup-node-deps'),
    'dependency installation'
  )
})

test('public changelog commit receives the API token only in its dedicated step', () => {
  const publishJob = job('publish-assets')
  const createCommit = step(publishJob, 'Create verified public changelog commit')
  const env = stepEnv(createCommit).join('\n')
  assert.match(env, /^\s+PUBLIC_RELEASE_TOKEN: \$\{\{ secrets\.PUBLIC_RELEASE_TOKEN \}\}$/m)
  assert.match(env, /^\s+SOURCE_RELEASE_TOKEN: \$\{\{ secrets\.RELEASE_TOKEN \|\| secrets\.GITHUB_TOKEN \}\}$/m)
  assert.doesNotMatch(env, /^\s+GH_TOKEN:/m)
})

test('GitHub CLI publishing and legacy bridge credentials remain step-scoped', () => {
  const publishJob = job('publish-assets')
  const release = step(publishJob, 'Publish signed-commit-backed public GitHub Release')
  assert.match(stepEnv(release).join('\n'), /^\s+GH_TOKEN: \$\{\{ secrets\.PUBLIC_RELEASE_TOKEN \}\}$/m)

  const legacy = step(publishJob, 'Publish legacy bridge release')
  assert.match(stepEnv(legacy).join('\n'), /^\s+LEGACY_TOKEN: \$\{\{ secrets\.RELEASE_TOKEN \|\| secrets\.GITHUB_TOKEN \}\}$/m)
  assert.match(legacy.join('\n'), /GH_TOKEN="\$LEGACY_TOKEN" gh release upload/)
  assert.doesNotMatch(stepEnv(legacy).join('\n'), /^\s+GH_TOKEN:/m)
})
