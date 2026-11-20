import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createWriteStream, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { test } from 'node:test'
import { buildPortableZip, verifyPortableZip } from './lib/portable-zip.mjs'

class FakeArchive extends PassThrough {
  directory() {}
  finalize() { this.end('replacement'); return Promise.resolve() }
  abort() { this.destroy() }
}

async function withDestination(run) {
  const dir = mkdtempSync(join(tmpdir(), 'ferry-portable-test-'))
  const destination = join(dir, 'Ferry-Portable-test.zip')
  writeFileSync(destination, 'original')
  try { await run({ dir, destination }) }
  finally { rmSync(dir, { recursive: true, force: true }) }
}

test('successful verified output replaces existing artifact', async () => withDestination(async ({ dir, destination }) => {
  await buildPortableZip({
    sourceDir: dir, destination, requiredEntries: [],
    archiveFactory: () => new FakeArchive(),
    verify: (path) => assert.equal(readFileSync(path, 'utf8'), 'replacement')
  })
  assert.equal(readFileSync(destination, 'utf8'), 'replacement')
}))

test('verification failure preserves original artifact', async () => withDestination(async ({ dir, destination }) => {
  await assert.rejects(buildPortableZip({
    sourceDir: dir, destination, requiredEntries: [],
    archiveFactory: () => new FakeArchive(),
    verify: () => { throw new Error('invalid archive') }
  }), /invalid archive/)
  assert.equal(readFileSync(destination, 'utf8'), 'original')
}))

test('premature output close fails and preserves original artifact', async () => withDestination(async ({ dir, destination }) => {
  const earlyClose = () => {
    const stream = new Writable({ write(_chunk, _encoding, callback) { callback() } })
    queueMicrotask(() => stream.destroy())
    return stream
  }
  await assert.rejects(buildPortableZip({
    sourceDir: dir, destination, requiredEntries: [],
    archiveFactory: () => new FakeArchive(), outputFactory: earlyClose, verify: () => {}
  }), /premature|closed|abort/i)
  assert.equal(readFileSync(destination, 'utf8'), 'original')
}))

test('write error fails and preserves original artifact', async () => withDestination(async ({ dir, destination }) => {
  const failedOutput = () => new Writable({
    write(_chunk, _encoding, callback) { callback(new Error('disk full')) }
  })
  await assert.rejects(buildPortableZip({
    sourceDir: dir, destination, requiredEntries: [],
    archiveFactory: () => new FakeArchive(), outputFactory: failedOutput, verify: () => {}
  }), /disk full/)
  assert.equal(readFileSync(destination, 'utf8'), 'original')
}))

test('finalization rejection preserves original artifact', async () => withDestination(async ({ dir, destination }) => {
  class FailedArchive extends FakeArchive {
    finalize() { return Promise.reject(new Error('finalize failed')) }
  }
  await assert.rejects(buildPortableZip({
    sourceDir: dir, destination, requiredEntries: [],
    archiveFactory: () => new FailedArchive(), verify: () => {}
  }), /finalize failed/)
  assert.equal(readFileSync(destination, 'utf8'), 'original')
}))

test('truncated ZIP fails structural validation', async () => withDestination(async ({ dir, destination }) => {
  writeFileSync(destination, Buffer.from('PK\\x03\\x04'))
  assert.throws(() => verifyPortableZip(destination, ['ferry-win_x64.exe']), /central-directory/)
}))
