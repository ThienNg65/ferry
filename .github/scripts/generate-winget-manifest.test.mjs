import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { generateWingetManifests, renderWingetManifests } from '../../scripts/generate-winget-manifest.mjs'

const sha = (data) => createHash('sha256').update(data).digest('hex')

async function fixture(t, contents = Buffer.from('MZdummy test executable')) {
  const directory = await mkdtemp(join(tmpdir(), 'ferry-winget-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const installer = join(directory, 'Ferry-Setup-1.2.2.exe')
  await writeFile(installer, contents)
  return { directory, installer, digest: sha(contents) }
}

test('renders a version-pinned three-file WinGet package', () => {
  const files = renderWingetManifests('1.2.2', 'a'.repeat(64))
  assert.equal(Object.keys(files).length, 3)
  assert.match(files['ThienNg65.Ferry.installer.yaml'], /InstallerType: nullsoft/)
  assert.match(files['ThienNg65.Ferry.installer.yaml'], /Scope: user/)
  assert.match(files['ThienNg65.Ferry.installer.yaml'], /InstallerSha256: A{64}/)
  assert.match(files['ThienNg65.Ferry.installer.yaml'], /ferry-v1\.2\.2\/Ferry-Setup-1\.2\.2\.exe/)
  for (const content of Object.values(files)) assert.match(content, /ManifestVersion: 1\.28\.0/)
})

test('generates from final on-disk installer and preserves identical manifest runs', async (t) => {
  const { directory, installer, digest } = await fixture(t)
  const params = { version: '1.2.2', installer, expectedSha256: digest, outputRoot: directory }
  const result = await generateWingetManifests(params)
  const installerYaml = await readFile(join(result.outputDir, 'ThienNg65.Ferry.installer.yaml'), 'utf8')
  assert.match(installerYaml, new RegExp(`InstallerSha256: ${digest.toUpperCase()}`))
  assert.deepEqual(await generateWingetManifests(params), result)
})

test('refuses mismatched asset hashes', async (t) => {
  const { directory, installer } = await fixture(t)
  await assert.rejects(generateWingetManifests({ version: '1.2.2', installer, expectedSha256: '0'.repeat(64), outputRoot: directory }), /SHA-256 mismatch/)
})

test('publishes a complete manifest set across concurrent generation attempts', async (t) => {
  const { directory, installer, digest } = await fixture(t)
  const params = { version: '1.2.2', installer, expectedSha256: digest, outputRoot: directory }
  const results = await Promise.all(Array.from({ length: 8 }, () => generateWingetManifests(params)))
  const [{ outputDir }] = results
  for (const result of results) assert.deepEqual(result, results[0])
  assert.deepEqual(await readdir(dirname(outputDir)), ['1.2.2'])
  for (const [name, content] of Object.entries(renderWingetManifests('1.2.2', digest))) {
    assert.equal(await readFile(join(outputDir, name), 'utf8'), content)
  }
})

test('rejects path traversal and mismatched installer names', async (t) => {
  const { directory, installer, digest } = await fixture(t)
  assert.throws(() => renderWingetManifests('../1.2.2', digest), /Version must be/)
  await assert.rejects(generateWingetManifests({ version: '1.2.3', installer, expectedSha256: digest, outputRoot: directory }), /Installer name must be/)
})

test('rejects invalid executables and refuses silently changed manifests', async (t) => {
  const { directory, installer, digest } = await fixture(t, Buffer.from('not an exe'))
  await assert.rejects(generateWingetManifests({ version: '1.2.2', installer, expectedSha256: digest, outputRoot: directory }), /Windows executable/)
  await writeFile(installer, Buffer.from('MZreal'))
  const params = { version: '1.2.2', installer, expectedSha256: sha(Buffer.from('MZreal')), outputRoot: directory }
  const { outputDir } = await generateWingetManifests(params)
  await writeFile(join(outputDir, 'ThienNg65.Ferry.installer.yaml'), 'modified')
  await assert.rejects(generateWingetManifests(params), /Existing manifest differs/)
})

test('accepts unchanged manifests checked out with Windows line endings', async (t) => {
  const { directory, installer, digest } = await fixture(t)
  const params = { version: '1.2.2', installer, expectedSha256: digest, outputRoot: directory }
  const { outputDir } = await generateWingetManifests(params)
  for (const [name, content] of Object.entries(renderWingetManifests('1.2.2', digest))) {
    await writeFile(join(outputDir, name), content.replaceAll('\n', '\r\n'))
  }
  await assert.doesNotReject(generateWingetManifests(params))
})

test('the checked-in 1.2.2 and 1.3.2 manifests match the public release asset digests', async () => {
  const checkedIn = [
    ['1.2.2', '4c19ab4760ff71d0cb2ef44b9e6c5aabe52b1e5c9e3daf24e54f0583229f3590'],
    ['1.3.2', 'cd7e5ef29011ca03460607505ec41c308c35f78672305a6d99bb2c83abce9db2']
  ]
  for (const [version, digest] of checkedIn) {
    const manifestDir = new URL(`../../packaging/winget/manifests/t/ThienNg65/Ferry/${version}/`, import.meta.url)
    for (const [filename, expected] of Object.entries(renderWingetManifests(version, digest))) {
      assert.equal((await readFile(new URL(filename, manifestDir), 'utf8')).replaceAll('\r\n', '\n'), expected)
    }
  }
})
