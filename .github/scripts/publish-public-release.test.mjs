import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  sanitizeReleaseNotes,
  prependChangelog,
  validatePublicReadme,
  formatPublicReleaseBody,
  buildPublicFileAdditions,
  PUBLIC_ASSET_FILES
} from './publish-public-release.mjs'

const privateNotes = `## [0.18.1](https://github.com/ThienNg65/ferry/compare/ferry-v0.18.0...ferry-v0.18.1) (2026-11-11)

### Bug Fixes

* migrate Ferry auto-update feed to public release repository ([#19](https://github.com/ThienNg65/ferry/issues/19)) ([d4bd577](https://github.com/ThienNg65/ferry/commit/d4bd5770a629c02c09c389dd63d0a80d9acd3902))`

test('public release notes preserve categories and remove private commit links', () => {
  const actual = sanitizeReleaseNotes(privateNotes, '0.18.1', 'ThienNg65/ferry')
  assert.match(actual, /^## 0\.18\.1 \(2026-11-11\)/)
  assert.match(actual, /### Bug Fixes/)
  assert.match(actual, /\* migrate Ferry auto-update feed to public release repository/)
  assert.doesNotMatch(actual, /github\.com\/ThienNg65\/ferry/)
  assert.doesNotMatch(actual, /d4bd577/)
  assert.doesNotMatch(actual, /#19/)
})

test('fail closed if a source link remains', () => {
  const notes = `${privateNotes}\n\nVisit https://github.com/ThienNg65/ferry/issues/5 for more.`
  assert.throws(() => sanitizeReleaseNotes(notes, '0.18.1', 'ThienNg65/ferry'), /private source link/)
})

test('prepend changelog and do not duplicate a published version', () => {
  const original = '# Changelog\n\nPublic notes.\n\n## v0.18.1 - 2026-11-11\n\nPrevious.\n'
  const notes = '## 0.18.2 (2026-11-12)\n\n### Bug Fixes\n\n* Fixed updates'
  const result = prependChangelog(original, notes, '0.18.2')
  assert.equal(result.changed, true)
  assert.ok(result.content.indexOf('0.18.2') < result.content.indexOf('0.18.1'))
  assert.equal(prependChangelog(result.content, notes, '0.18.2').changed, false)
})

test('reject malformed notes', () => {
  assert.throws(() => sanitizeReleaseNotes('No release heading', '0.18.2', 'ThienNg65/ferry'))
})

test('validatePublicReadme accepts the checked-in template and rejects private repo links', async () => {
  const templateUrl = new URL('../../docs/public-release-template/README.md', import.meta.url)
  const template = await readFile(templateUrl, 'utf8')
  const validated = validatePublicReadme(template, 'ThienNg65/ferry')
  assert.doesNotMatch(validated, /\r\n/)
  assert.match(validated, /9PJPWK568P53/)
  assert.match(validated, /https:\/\/www\.ferryssh\.com/)
  assert.doesNotMatch(validated, /v0\.18\.1\s+bridge\s+release/i)
  assert.match(validated, /\[GitHub Releases\]\(\.\.\/\.\.\/releases\/latest\)/)
  assert.match(validated, /\[Microsoft Store\]\(https:\/\/apps\.microsoft\.com\/detail\/9PJPWK568P53\)/)
  for (const [, remotePath] of PUBLIC_ASSET_FILES) {
    assert.ok(validated.includes(remotePath), `Expected public README to reference ${remotePath}`)
  }

  assert.doesNotThrow(() => validatePublicReadme('See https://github.com/ThienNg65/ferry-release/issues', 'ThienNg65/ferry'))
  assert.throws(() => validatePublicReadme('Report bugs at https://github.com/ThienNg65/ferry/issues', 'ThienNg65/ferry'), /private source link/)
  assert.throws(() => validatePublicReadme('API: https://api.github.com/repos/ThienNg65/ferry/releases', 'ThienNg65/ferry'), /private source link/)
})

test('formatPublicReleaseBody lists Microsoft Store, NSIS installer, and portable ZIP', () => {
  const notes = '## 1.3.2 (2026-11-21)\n\n### Features\n\n* Added automated sync'
  const body = formatPublicReleaseBody(notes, '1.3.2')
  assert.match(body, /https:\/\/apps\.microsoft\.com\/detail\/9PJPWK568P53/)
  assert.match(body, /`Ferry-Setup-1\.3\.2\.exe`/)
  assert.match(body, /`Ferry-Portable-1\.3\.2-win-x64\.zip`/)
})

test('buildPublicFileAdditions includes modified text and binary assets and skips unchanged files', () => {
  const unchanged = buildPublicFileAdditions({
    currentChangelog: '# Changelog\n',
    nextChangelog: '# Changelog\r\n',
    currentReadme: '# Ferry\n',
    nextReadme: '# Ferry\r\n',
    assets: [{ path: 'assets/files.jpg', nextBase64: 'AQI=', currentBase64: 'AQI=' }]
  })
  assert.deepEqual(unchanged, [])

  const readmeAndAsset = buildPublicFileAdditions({
    currentChangelog: '# Changelog\n',
    nextChangelog: '# Changelog\n',
    currentReadme: '# Ferry\nOld\n',
    nextReadme: '# Ferry\nNew\n',
    assets: [
      { path: 'assets/files.jpg', nextBase64: 'AQI=', currentBase64: 'AQI=' },
      { path: 'assets/sync.jpg', nextBase64: 'AwQ=', currentBase64: 'BQU=' }
    ]
  })
  assert.deepEqual(readmeAndAsset.map(item => item.path), ['README.md', 'assets/sync.jpg'])
  assert.equal(Buffer.from(readmeAndAsset[0].contents, 'base64').toString('utf8'), '# Ferry\nNew\n')
  assert.equal(readmeAndAsset[1].contents, 'AwQ=')

  const both = buildPublicFileAdditions({
    currentChangelog: '# Changelog\n',
    nextChangelog: '# Changelog\n\n## 1.3.2\n',
    currentReadme: null,
    nextReadme: '# Ferry\n',
    assets: [{ path: 'assets/monitor.jpg', nextBase64: 'Bwc=', currentBase64: null }]
  })
  assert.deepEqual(both.map(item => item.path), ['CHANGELOG.md', 'README.md', 'assets/monitor.jpg'])
})
