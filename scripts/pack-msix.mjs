import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { execFileSync } from 'child_process'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const distDir = join(rootDir, 'dist')
const protoDir = join(distDir, 'ferry-neutralino-win_x64')
const msixStageDir = join(distDir, 'ferry-msix-win_x64')
const msixTemplateDir = join(rootDir, 'build', 'msix')

const psfVersion = '1.0.240212.1'
const psfHash = '1d8e26ce29657b042cea1c134fe0cda5f3ee4a1575c4776091aeae3f683e5fba'
const psfFiles = ['PsfLauncher64.exe', 'PsfRuntime64.dll', 'PsfRunDll64.exe']

async function stagePackageSupportFramework() {
  const tempDir = mkdtempSync(join(tmpdir(), 'ferry-msix-psf-'))
  try {
    const cachedArchive = process.env.FERRY_PSF_ARCHIVE
    let bytes
    if (cachedArchive) {
      bytes = readFileSync(cachedArchive)
    } else {
      const packageName = 'microsoft.packagesupportframework'
      const url = `https://api.nuget.org/v3-flatcontainer/${packageName}/${psfVersion}/${packageName}.${psfVersion}.nupkg`
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
      if (!response.ok) throw new Error(`Cannot download Microsoft Package Support Framework: HTTP ${response.status}`)
      bytes = Buffer.from(await response.arrayBuffer())
    }
    if (createHash('sha256').update(bytes).digest('hex') !== psfHash) {
      throw new Error(`Microsoft Package Support Framework ${psfVersion} archive failed SHA-256 verification`)
    }

    const archive = join(tempDir, 'psf.zip')
    writeFileSync(archive, bytes)
    const entries = psfFiles.map((file) => `bin/${file}`)
    if (process.platform === 'win32') {
      const windowsTar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
      execFileSync(windowsTar, ['-xf', archive, '-C', tempDir, ...entries], { stdio: 'inherit' })
    } else {
      execFileSync('unzip', ['-q', archive, ...entries, '-d', tempDir], { stdio: 'inherit' })
    }
    for (const file of psfFiles) {
      cpSync(join(tempDir, 'bin', file), join(msixStageDir, file))
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
const rawVersion = String(pkg.version || '0.0.0').split('-')[0]
const [major = 0, minor = 0, patch = 0] = rawVersion.split('.').map((n) => Number.parseInt(n, 10) || 0)
const msixVersion = process.env.FERRY_MSIX_VERSION?.trim() || `${major}.${minor}.${patch}.0`

// Microsoft Store rejects MSIX packages with Major=0 or non-zero Revision.
const parts = msixVersion.split('.').map((n) => (/^\d+$/.test(n) ? Number(n) : -1))
if (
  parts.length !== 4 ||
  parts[0] < 1 ||
  parts[0] > 65535 ||
  parts[1] < 0 ||
  parts[1] > 65535 ||
  parts[2] < 0 ||
  parts[2] > 65535 ||
  parts[3] !== 0
) {
  throw new Error(
    `Invalid Microsoft Store MSIX version "${msixVersion}" (from package.json "${pkg.version}"). ` +
      'Store MSIX packages require Major.Minor.Build.0 with Major >= 1 (release v1.0.0+ or set FERRY_MSIX_VERSION).'
  )
}

const exePath = join(protoDir, 'ferry-win_x64.exe')
if (!existsSync(exePath)) {
  throw new Error(`Missing packaged Neutralino build at ${protoDir}. Run "npm run package" first.`)
}

const outMsix = join(distDir, `FerryFileClient-${msixVersion}-x64.msix`)
rmSync(msixStageDir, { recursive: true, force: true })
cpSync(protoDir, msixStageDir, { recursive: true })
cpSync(join(msixTemplateDir, 'assets'), join(msixStageDir, 'assets'), { recursive: true })
for (const file of ['config.json', 'PACKAGE_SUPPORT_FRAMEWORK_LICENSE.txt']) {
  cpSync(join(msixTemplateDir, file), join(msixStageDir, file))
}

// Neutralino starts the Node extension through cmd.exe. Keep that shell in the package context.
await stagePackageSupportFramework()

const manifest = readFileSync(join(msixTemplateDir, 'AppxManifest.xml'), 'utf8').replaceAll(
  '{{VERSION}}',
  msixVersion
)
writeFileSync(join(msixStageDir, 'AppxManifest.xml'), manifest, 'utf8')

function findMakeAppx() {
  if (process.env.FERRY_MAKEAPPX) {
    if (!existsSync(process.env.FERRY_MAKEAPPX)) {
      throw new Error(`FERRY_MAKEAPPX does not exist: ${process.env.FERRY_MAKEAPPX}`)
    }
    return process.env.FERRY_MAKEAPPX
  }
  const kitsBin = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin')
  if (!existsSync(kitsBin)) return null
  const versions = readdirSync(kitsBin)
    .filter((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  for (const ver of versions) {
    const candidate = join(kitsBin, ver, 'x64', 'makeappx.exe')
    if (existsSync(candidate)) return candidate
  }
  return null
}

const makeAppx = findMakeAppx()
if (!makeAppx) {
  console.log(`Staged MSIX folder ready at: ${msixStageDir}`)
  console.log('makeappx.exe not found (install Windows 10/11 SDK or run on GitHub Actions windows-latest).')
  console.log(`Once available, pack with:\n  makeappx.exe pack /o /d "${msixStageDir}" /p "${outMsix}"`)
  process.exit(process.platform === 'win32' ? 1 : 0)
}

// Keep a previous valid package if preparation, MakeAppx, or replacement fails.
const outputDir = mkdtempSync(join(distDir, '.ferry-msix-pack-'))
try {
  const stagedMsix = join(outputDir, `FerryFileClient-${msixVersion}-x64.msix`)
  execFileSync(makeAppx, ['pack', '/o', '/d', msixStageDir, '/p', stagedMsix], { stdio: 'inherit' })
  if (statSync(stagedMsix).size === 0) throw new Error('MakeAppx produced an empty MSIX package')
  renameSync(stagedMsix, outMsix)
} finally {
  rmSync(outputDir, { recursive: true, force: true })
}
console.log(`MSIX package created: ${outMsix} (${(statSync(outMsix).size / (1024 * 1024)).toFixed(2)} MB)`)
