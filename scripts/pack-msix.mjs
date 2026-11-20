import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const distDir = join(rootDir, 'dist')
const protoDir = join(distDir, 'ferry-neutralino-win_x64')
const msixStageDir = join(distDir, 'ferry-msix-win_x64')
const msixTemplateDir = join(rootDir, 'build', 'msix')

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

rmSync(msixStageDir, { recursive: true, force: true })
cpSync(protoDir, msixStageDir, { recursive: true })
cpSync(join(msixTemplateDir, 'assets'), join(msixStageDir, 'assets'), { recursive: true })

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

const outMsix = join(distDir, `FerryFileClient-${msixVersion}-x64.msix`)
rmSync(outMsix, { force: true })

const makeAppx = findMakeAppx()
if (!makeAppx) {
  console.log(`Staged MSIX folder ready at: ${msixStageDir}`)
  console.log('makeappx.exe not found (install Windows 10/11 SDK or run on GitHub Actions windows-latest).')
  console.log(`Once available, pack with:\n  makeappx.exe pack /o /d "${msixStageDir}" /p "${outMsix}"`)
  process.exit(0)
}

execFileSync(makeAppx, ['pack', '/o', '/d', msixStageDir, '/p', outMsix], { stdio: 'inherit' })
console.log(`MSIX package created: ${outMsix} (${(statSync(outMsix).size / (1024 * 1024)).toFixed(2)} MB)`)
