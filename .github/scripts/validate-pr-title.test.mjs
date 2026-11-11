import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isConventionalTitle } from './validate-pr-title.mjs'

test('accepts release-worthy types and optional scope/breaking marker', () => {
  for (const title of [
    'feat: improve the file browser',
    'fix(ssh): recover from disconnected connections',
    'perf: improve directory loading',
    'feat!: replace outdated update protocol',
    'refactor(sync): simplify scheduling'
  ]) assert.equal(isConventionalTitle(title), true, title)
})

test('accepts bot and maintenance pull requests', () => {
  for (const title of [
    'chore(main): release ferry 0.19.0',
    'build(deps-dev): bump vitest from 2.1.9 to 3.2.6',
    'ci: improve release pipeline',
    'docs: update installation guide',
    'test: add regression coverage',
    'revert: restore previous updater'
  ]) assert.equal(isConventionalTitle(title), true, title)
})

test('rejects PR titles that Release Please cannot classify', () => {
  for (const title of [
    'Feat/ux feedback p2 p3',
    'Merge pull request #28 from ThienNg65/feat/ux-feedback-p2-p3',
    'Improve the UI',
    'feat/ux feedback',
    'Feature: improve the UI',
    'fix: ',
    'fix:  ',
    ' feat: accidental leading space',
    'feat: trailing space '
  ]) assert.equal(isConventionalTitle(title), false, title)
})
