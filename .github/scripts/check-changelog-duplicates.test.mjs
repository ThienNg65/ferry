import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { findDuplicateChangelogEntries, normalizeEntrySubject } from './check-changelog-duplicates.mjs'

test('normalizeEntrySubject strips scope, PR links, and commit links', () => {
  const line = '* **ssh:** preserve UTF-8 across remote output chunks ([#161](https://github.com/ThienNg65/ferry/issues/161)) ([a8c6cfa](https://github.com/ThienNg65/ferry/commit/a8c6cfa7c6459da03c6e557b233356509ab07196))'
  assert.equal(normalizeEntrySubject(line), 'preserve utf 8 across remote output chunks')
})

test('detects duplicate entries from merge commit and original commit in the same release', () => {
  const sample = `# Changelog

## [1.4.2](https://github.com/ThienNg65/ferry/compare/ferry-v1.4.1...ferry-v1.4.2) (2026-11-26)

### Bug Fixes

* **ssh:** preserve UTF-8 across remote output chunks ([#161](https://github.com/ThienNg65/ferry/issues/161)) ([a8c6cfa](https://github.com/ThienNg65/ferry/commit/a8c6cfa7c6459da03c6e557b233356509ab07196))
* preserve UTF-8 across remote output chunks ([02022d0](https://github.com/ThienNg65/ferry/commit/02022d0344efb114d305b373d7e867a94738d163))
`
  const dups = findDuplicateChangelogEntries(sample, { latestOnly: true })
  assert.equal(dups.length, 1)
  assert.equal(dups[0].version, '1.4.2')
  assert.equal(dups[0].reason, 'duplicate-subject')
})

test('detects duplicate entries referencing the same PR number', () => {
  const sample = `## [1.4.2](https://github.com/ThienNg65/ferry/compare/ferry-v1.4.1...ferry-v1.4.2) (2026-11-26)

### Bug Fixes

* **ssh:** first entry ([#161](https://github.com/ThienNg65/ferry/issues/161)) ([a8c6cfa](https://github.com/ThienNg65/ferry/commit/a8c6cfa7c6459da03c6e557b233356509ab07196))
* second entry ([#161](https://github.com/ThienNg65/ferry/issues/161)) ([02022d0](https://github.com/ThienNg65/ferry/commit/02022d0344efb114d305b373d7e867a94738d163))
`
  const dups = findDuplicateChangelogEntries(sample, { latestOnly: true })
  assert.equal(dups.length, 1)
  assert.equal(dups[0].reason, 'duplicate-pr-#161')
})

test('latest release section in repository CHANGELOG.md has no duplicate entries', () => {
  const changelog = readFileSync(resolve(process.cwd(), 'CHANGELOG.md'), 'utf8')
  assert.deepEqual(findDuplicateChangelogEntries(changelog, { latestOnly: true }), [])
})
