import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ID = 'ThienNg65.Ferry'
const SCHEMA_VERSION = '1.28.0'
const DEFAULT_OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'winget')
const RELEASE_URL = 'https://github.com/ThienNg65/ferry-release/releases/download'

export function renderWingetManifests(version, sha256) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
    throw new Error('Version must be a stable numeric release, e.g. 1.2.2')
  }
  if (!/^[a-f0-9]{64}$/i.test(sha256)) {
    throw new Error('Expected a 64-character SHA-256 hash')
  }
  const header = (type) => `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.${SCHEMA_VERSION}.schema.json\n`
  const common = `PackageIdentifier: ${PACKAGE_ID}\nPackageVersion: ${version}\n`
  const suffix = (type) => `ManifestType: ${type}\nManifestVersion: ${SCHEMA_VERSION}\n`
  return {
    [`${PACKAGE_ID}.yaml`]: `${header('version')}${common}DefaultLocale: en-US\n${suffix('version')}`,
    [`${PACKAGE_ID}.installer.yaml`]:
      `${header('installer')}${common}InstallerType: nullsoft\nScope: user\nUpgradeBehavior: install\n` +
      `Installers:\n  - Architecture: x64\n    InstallerUrl: ${RELEASE_URL}/ferry-v${version}/Ferry-Setup-${version}.exe\n` +
      `    InstallerSha256: ${sha256.toUpperCase()}\n    ProductCode: Ferry\n${suffix('installer')}`,
    [`${PACKAGE_ID}.locale.en-US.yaml`]: `${header('defaultLocale')}${common}PackageLocale: en-US\n` +
      `Publisher: ThienNg65\nPublisherUrl: https://github.com/ThienNg65\n` +
      `PublisherSupportUrl: https://github.com/ThienNg65/ferry/issues\nPackageName: Ferry\n` +
      `PackageUrl: https://github.com/ThienNg65/ferry-release\nLicense: MIT\n` +
      `LicenseUrl: https://github.com/ThienNg65/ferry-release/blob/main/LICENSE\n` +
      `ShortDescription: Lightweight Windows SSH/SFTP client for file transfers, terminal access, and live logs.\n` +
      `Tags:\n  - sftp\n  - ssh\n  - terminal\n  - file-transfer\n${suffix('defaultLocale')}`
  }
}

export async function generateWingetManifests({ version, installer, expectedSha256, outputRoot = DEFAULT_OUTPUT }) {
  // Validate user-controlled version before it is used in a directory name or URL.
  renderWingetManifests(version, expectedSha256)
  if (basename(installer) !== `Ferry-Setup-${version}.exe`) {
    throw new Error(`Installer name must be Ferry-Setup-${version}.exe`)
  }
  const data = await readFile(installer)
  if (data.length < 2 || data.toString('ascii', 0, 2) !== 'MZ') {
    throw new Error('Input does not look like a Windows executable')
  }
  const actualSha256 = createHash('sha256').update(data).digest('hex')
  if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(`Installer SHA-256 mismatch: expected ${expectedSha256}, actual ${actualSha256}`)
  }
  const files = renderWingetManifests(version, actualSha256)
  const outputDir = join(outputRoot, 'manifests', 't', 'ThienNg65', 'Ferry', version)

  // Never silently replace manifests for the same published version with changed bytes.
  for (const [name, content] of Object.entries(files)) {
    try {
      if ((await readFile(join(outputDir, name), 'utf8')) !== content) {
        throw new Error(`Existing manifest differs: ${join(outputDir, name)}`)
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  await mkdir(outputDir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(outputDir, name), content, { flag: 'wx' }).catch((error) => {
      if (error.code !== 'EEXIST') throw error
    })
  }
  return { outputDir, sha256: actualSha256 }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!['--version', '--installer', '--expected-sha256', '--output'].includes(args[i]) || !args[i + 1]) {
      console.error('Usage: node scripts/generate-winget-manifest.mjs --version X.Y.Z --installer <final-release.exe> --expected-sha256 <hash> [--output <directory>]')
      process.exitCode = 1
      break
    }
    options[args[i]] = args[i + 1]
  }
  if (!process.exitCode) {
    generateWingetManifests({
      version: options['--version'],
      installer: options['--installer'],
      expectedSha256: options['--expected-sha256'],
      outputRoot: options['--output']
    }).then(({ outputDir, sha256 }) => {
      console.log(`WinGet manifests created: ${outputDir}\nSHA-256: ${sha256}`)
    }).catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
  }
}
