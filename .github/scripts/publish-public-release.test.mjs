import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeReleaseNotes, prependChangelog } from './publish-public-release.mjs'

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
