import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractReleasePrBranches,
  resolveVersionSync,
  syncReleasePrVersion
} from './sync-release-pr-version.mjs'

test('extractReleasePrBranches combines RELEASE_PRS and open same-repo release-please PRs while excluding forks', () => {
  const branches = extractReleasePrBranches({
    repo: 'ThienNg65/ferry',
    baseBranch: 'main',
    releasePrsJson: JSON.stringify([
      { headBranchName: 'release-please--branches--main--components--ferry', baseBranchName: 'main', number: 194 },
      { headBranchName: 'release-please--branches--next--components--ferry', baseBranchName: 'next', number: 195 }
    ]),
    openPulls: [
      {
        head: { ref: 'release-please--branches--main--components--ferry', repo: { full_name: 'ThienNg65/ferry' } },
        base: { ref: 'main', repo: { full_name: 'ThienNg65/ferry' } }
      },
      {
        head: { ref: 'release-please--branches--main--components--fork', repo: { full_name: 'external/ferry' } },
        base: { ref: 'main', repo: { full_name: 'ThienNg65/ferry' } }
      },
      {
        head: { ref: 'release-please--branches--main--components--deleted-fork', repo: null },
        base: { ref: 'main', repo: { full_name: 'ThienNg65/ferry' } }
      },
      {
        head: { ref: 'feat/some-feature', repo: { full_name: 'ThienNg65/ferry' } },
        base: { ref: 'main', repo: { full_name: 'ThienNg65/ferry' } }
      }
    ]
  })

  assert.deepEqual(branches, ['release-please--branches--main--components--ferry'])
})

test('resolveVersionSync detects stale VERSION and validates manifest alignment', () => {
  const stale = resolveVersionSync({
    packageJsonText: JSON.stringify({ name: 'ferry', version: '1.5.0' }),
    manifestJsonText: JSON.stringify({ '.': '1.5.0' }),
    versionText: '1.4.0\n'
  })
  assert.deepEqual(stale, {
    targetVersion: '1.5.0',
    currentVersion: '1.4.0',
    changed: true,
    nextContent: '1.5.0\n'
  })

  const synced = resolveVersionSync({
    packageJsonText: JSON.stringify({ name: 'ferry', version: '1.5.0' }),
    manifestJsonText: JSON.stringify({ '.': '1.5.0' }),
    versionText: '1.5.0\r\n'
  })
  assert.equal(synced.changed, false)

  assert.throws(
    () =>
      resolveVersionSync({
        packageJsonText: JSON.stringify({ name: 'ferry', version: '1.5.0' }),
        manifestJsonText: JSON.stringify({ '.': '1.4.0' }),
        versionText: '1.4.0\n'
      }),
    /does not match package\.json/
  )
})

test('syncReleasePrVersion updates stale VERSION on the release PR branch and skips when already synced', async () => {
  const calls = []
  const branch = 'release-please--branches--main--components--ferry'
  const mockFetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null })

    if (url.endsWith('/pulls?state=open&base=main&per_page=100')) {
      return new Response(
        JSON.stringify([
          {
            head: { ref: branch, repo: { full_name: 'ThienNg65/ferry' } },
            base: { ref: 'main', repo: { full_name: 'ThienNg65/ferry' } }
          }
        ]),
        { status: 200 }
      )
    }
    if (url.includes('/contents/package.json')) {
      return new Response(
        JSON.stringify({
          encoding: 'base64',
          content: Buffer.from(JSON.stringify({ version: '1.5.0' })).toString('base64'),
          sha: 'pkg-sha'
        }),
        { status: 200 }
      )
    }
    if (url.includes('/contents/.release-please-manifest.json')) {
      return new Response(
        JSON.stringify({
          encoding: 'base64',
          content: Buffer.from(JSON.stringify({ '.': '1.5.0' })).toString('base64'),
          sha: 'manifest-sha'
        }),
        { status: 200 }
      )
    }
    if (url.includes('/contents/VERSION') && (init.method ?? 'GET') === 'GET') {
      return new Response(
        JSON.stringify({
          encoding: 'base64',
          content: Buffer.from('1.4.0\n').toString('base64'),
          sha: 'version-sha-140'
        }),
        { status: 200 }
      )
    }
    if (url.endsWith('/contents/VERSION') && init.method === 'PUT') {
      return new Response(JSON.stringify({ commit: { sha: 'abc1234' } }), { status: 200 })
    }
    throw new Error(`Unexpected fetch: ${init.method ?? 'GET'} ${url}`)
  }

  const logs = []
  const res = await syncReleasePrVersion({
    repo: 'ThienNg65/ferry',
    token: 'test-token',
    fetchImpl: mockFetch,
    log: (msg) => logs.push(msg)
  })

  assert.deepEqual(res, [{ branch, targetVersion: '1.5.0', updated: true, commitSha: 'abc1234' }])
  const putCall = calls.find((c) => c.method === 'PUT')
  assert.ok(putCall)
  assert.equal(putCall.body.branch, branch)
  assert.equal(putCall.body.sha, 'version-sha-140')
  assert.equal(putCall.body.message, 'chore(release): sync VERSION to 1.5.0')
  assert.equal(Buffer.from(putCall.body.content, 'base64').toString('utf8'), '1.5.0\n')
})
