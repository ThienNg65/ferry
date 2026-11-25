import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('DPAPI tests stay isolated from the installed Ferry profile', async () => {
  const source = await readFile(
    new URL('../../src/main/host/dpapiKey.test.ts', import.meta.url),
    'utf8'
  )

  assert.doesNotMatch(source, /\b(?:APPDATA|USERPROFILE)\b/i)
  assert.doesNotMatch(source, /['"]Ferry['"]/i)
  assert.doesNotMatch(source, /sites\.json/i)
  assert.match(source, /mkdtempSync\(path\.join\(tmpdir\(\)/)
})
