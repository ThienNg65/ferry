import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, copyFileSync, statSync, writeFileSync } from 'fs'
import { execFileSync, spawnSync } from 'child_process'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { buildPortableZip } from './lib/portable-zip.mjs'
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit'

const MAX_COMPRESSED_BYTES = 45 * 1024 * 1024 // 45 MB feasibility gate (<= 50% of Electron setup)

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const distDir = join(rootDir, 'dist')
const protoDir = join(distDir, 'ferry-neutralino-win_x64')
const sidecarDistDir = join(protoDir, 'extensions', 'js.ferry.sidecar')

const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
const version = String(pkg.version || '0.0.0')

const nlConfigPath = join(rootDir, 'neutralino.config.json')
const originalNlConfigText = readFileSync(nlConfigPath, 'utf8')
const nlConfig = JSON.parse(originalNlConfigText)
const nlConfigNeedsVersionSync = nlConfig.version !== version

const rendererIndex = join(rootDir, 'out', 'renderer', 'index.html')
const sidecarBundle = join(rootDir, 'out', 'sidecar', 'index.cjs')
if (!existsSync(rendererIndex) || !existsSync(sidecarBundle)) {
  throw new Error('Missing built artifacts. Run "npm run build" before packaging.')
}

if (existsSync(distDir)) {
  for (const entry of readdirSync(distDir)) {
    if (
      /^Ferry-Setup-.*\.exe$/i.test(entry) ||
      /^Ferry-Portable-.*\.zip$/i.test(entry) ||
      /\.blockmap$/i.test(entry) ||
      entry === 'latest.yml' ||
      entry === 'latest-neutralino.yml'
    ) {
      rmSync(join(distDir, entry), { force: true })
    }
  }
}

function brandWindowsExecutable(exePath, iconPath, appVersion) {
  const exe = NtExecutable.from(readFileSync(exePath), { ignoreCert: true })
  const res = NtExecutableResource.from(exe)

  const iconFile = Data.IconFile.from(readFileSync(iconPath))
  const iconGroups = Resource.IconGroupEntry.fromEntries(res.entries)
  const iconGroupId = iconGroups.length > 0 ? iconGroups[0].id : 1
  Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    iconGroupId,
    1033,
    iconFile.icons.map((icon) => icon.data)
  )

  const viList = Resource.VersionInfo.fromEntries(res.entries)
  const vi = viList.length > 0 ? viList[0] : Resource.VersionInfo.createEmpty()
  const [major = 0, minor = 0, patch = 0] = appVersion
    .split('-')[0]
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0)
  vi.setFileVersion(major, minor, patch, 0, 1033)
  vi.setProductVersion(major, minor, patch, 0, 1033)
  vi.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      ProductName: 'Ferry',
      FileDescription: 'Ferry',
      CompanyName: 'ThienNg65',
      InternalName: 'Ferry',
      OriginalFilename: 'ferry-win_x64.exe',
      ProductVersion: appVersion,
      FileVersion: appVersion
    }
  )
  vi.outputToResourceEntries(res.entries)
  res.outputResource(exe)
  writeFileSync(exePath, Buffer.from(exe.generate()))
}

function runNpx(args) {
  if (process.platform === 'win32') {
    execFileSync('cmd.exe', ['/d', '/c', 'npx.cmd', '--registry=https://registry.npmjs.org', ...args], {
      cwd: rootDir,
      stdio: 'inherit'
    })
  } else {
    execFileSync('npx', ['--registry=https://registry.npmjs.org', ...args], {
      cwd: rootDir,
      stdio: 'inherit'
    })
  }
}

const expectedNlVersion = String(nlConfig.cli?.binaryVersion || '')
const nlVersionMarker = join(rootDir, 'bin', '.ferry-nl-version')
const cachedNlVersion = existsSync(nlVersionMarker) ? readFileSync(nlVersionMarker, 'utf8').trim() : ''

if (!existsSync(join(rootDir, 'bin', 'neutralino-win_x64.exe')) || cachedNlVersion !== expectedNlVersion) {
  runNpx(['@neutralinojs/neu', 'update'])
  mkdirSync(join(rootDir, 'bin'), { recursive: true })
  writeFileSync(nlVersionMarker, expectedNlVersion, 'utf8')
}

rmSync(join(distDir, 'ferry'), { recursive: true, force: true })
if (nlConfigNeedsVersionSync) {
  nlConfig.version = version
  writeFileSync(nlConfigPath, JSON.stringify(nlConfig, null, 2) + '\n', 'utf8')
}
try {
  runNpx(['@neutralinojs/neu', 'build'])
} finally {
  if (nlConfigNeedsVersionSync) {
    writeFileSync(nlConfigPath, originalNlConfigText, 'utf8')
  }
}

rmSync(protoDir, { recursive: true, force: true })
mkdirSync(sidecarDistDir, { recursive: true })
const targetExePath = join(protoDir, 'ferry-win_x64.exe')
copyFileSync(join(distDir, 'ferry', 'ferry-win_x64.exe'), targetExePath)
brandWindowsExecutable(targetExePath, join(rootDir, 'resources', 'icon.ico'), version)
copyFileSync(join(distDir, 'ferry', 'resources.neu'), join(protoDir, 'resources.neu'))
copyFileSync(process.execPath, join(sidecarDistDir, process.platform === 'win32' ? 'node.exe' : 'node'))
copyFileSync(sidecarBundle, join(sidecarDistDir, 'index.cjs'))
for (const noticeFile of ['LICENSE', 'PRIVACY.md', 'TERMS.md', 'THIRD_PARTY_LICENSES.txt']) {
  const srcNotice = join(rootDir, noticeFile)
  if (!existsSync(srcNotice)) {
    throw new Error(`Missing required legal/license file for packaging: ${srcNotice}`)
  }
  copyFileSync(srcNotice, join(protoDir, noticeFile))
}

const zipPath = join(distDir, `Ferry-Portable-${version}-win-x64.zip`)
await buildPortableZip({
  sourceDir: protoDir,
  destination: zipPath,
  maxBytes: MAX_COMPRESSED_BYTES,
  requiredEntries: [
    'ferry-win_x64.exe',
    'resources.neu',
    `extensions/js.ferry.sidecar/${process.platform === 'win32' ? 'node.exe' : 'node'}`,
    'extensions/js.ferry.sidecar/index.cjs',
    'LICENSE',
    'PRIVACY.md',
    'TERMS.md',
    'THIRD_PARTY_LICENSES.txt'
  ]
})

function findMakensis() {
  // CI supplies an explicitly verified compiler path; do not silently ignore it.
  if (process.env.FERRY_MAKENSIS) {
    if (!existsSync(process.env.FERRY_MAKENSIS)) {
      throw new Error(`FERRY_MAKENSIS does not exist: ${process.env.FERRY_MAKENSIS}`)
    }
    return process.env.FERRY_MAKENSIS
  }
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['makensis'], { encoding: 'utf8' })
  if (probe.status === 0 && probe.stdout) {
    const first = probe.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
    if (first && existsSync(first)) return first
  }
  const candidates = [
    join(process.env.ProgramFiles || 'C:\\Program Files', 'NSIS', 'makensis.exe'),
    join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'NSIS', 'makensis.exe')
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  const nsisCacheDir = join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'nsis')
  if (existsSync(nsisCacheDir)) {
    for (const dir of readdirSync(nsisCacheDir)) {
      for (const rel of ['Bin\\makensis.exe', 'makensis.exe']) {
        const p = join(nsisCacheDir, dir, rel)
        if (existsSync(p)) return p
      }
    }
  }
  return null
}

const makensisBin = findMakensis()
if (!makensisBin && process.env.FERRY_REQUIRE_NSIS === '1') {
  throw new Error('NSIS compiler is required for this build. Install NSIS or provide FERRY_MAKENSIS.')
}
let installerPath = null
if (makensisBin) {
  execFileSync(makensisBin, [`/DVERSION=${version}`, join(rootDir, 'build', 'neutralino-installer.nsi')], {
    cwd: rootDir,
    stdio: 'inherit'
  })
  const exeName = `Ferry-Setup-${version}.exe`
  installerPath = join(distDir, exeName)
  if (!existsSync(installerPath)) {
    throw new Error(`NSIS exited successfully but did not create ${installerPath}`)
  }
  const installerBuf = readFileSync(installerPath)
  const sha512 = createHash('sha512').update(installerBuf).digest('base64')
  const latestYml = `version: ${version}\nfiles:\n  - url: ${exeName}\n    sha512: ${sha512}\n    size: ${installerBuf.length}\npath: ${exeName}\nsha512: ${sha512}\nreleaseDate: '${new Date().toISOString()}'\n`
  writeFileSync(join(distDir, 'latest.yml'), latestYml, 'utf8')
}

const files = [
  ['ferry-win_x64.exe', join(protoDir, 'ferry-win_x64.exe')],
  ['resources.neu', join(protoDir, 'resources.neu')],
  ['index.cjs', join(sidecarDistDir, 'index.cjs')],
  [process.platform === 'win32' ? 'node.exe' : 'node', join(sidecarDistDir, process.platform === 'win32' ? 'node.exe' : 'node')]
]
let unpackedBytes = 0
for (const [label, filePath] of files) {
  const bytes = statSync(filePath).size
  unpackedBytes += bytes
  console.log(`  ${label}: ${bytes} bytes (${(bytes / (1024 * 1024)).toFixed(2)} MB)`)
}

const zipBytes = statSync(zipPath).size
console.log(`Unpacked total: ${unpackedBytes} bytes (${(unpackedBytes / (1024 * 1024)).toFixed(2)} MB)`)
console.log(`Compressed ZIP: ${zipPath} -> ${zipBytes} bytes (${(zipBytes / (1024 * 1024)).toFixed(2)} MB)`)

if (installerPath && existsSync(installerPath)) {
  const exeBytes = statSync(installerPath).size
  console.log(`NSIS Installer: ${installerPath} -> ${exeBytes} bytes (${(exeBytes / (1024 * 1024)).toFixed(2)} MB)`)
  console.log(`Update Manifest: ${join(distDir, 'latest.yml')}`)
  if (exeBytes > MAX_COMPRESSED_BYTES) {
    throw new Error(`NSIS installer (${exeBytes} bytes) exceeds ${MAX_COMPRESSED_BYTES} byte limit.`)
  }
} else {
  console.log('NSIS Installer: skipped (makensis not found)')
}

if (zipBytes > MAX_COMPRESSED_BYTES) {
  throw new Error(`Compressed package (${zipBytes} bytes) exceeds ${MAX_COMPRESSED_BYTES} byte limit.`)
}
