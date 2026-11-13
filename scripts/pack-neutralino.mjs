import { createHash } from 'crypto'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, copyFileSync, statSync, writeFileSync } from 'fs'
import { execFileSync, spawnSync } from 'child_process'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { ZipArchive } from 'archiver'

const MAX_COMPRESSED_BYTES = 45 * 1024 * 1024 // 45 MB feasibility gate (<= 50% of Electron setup)

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const distDir = join(rootDir, 'dist')
const protoDir = join(distDir, 'ferry-neutralino-win_x64')
const sidecarDistDir = join(protoDir, 'extensions', 'js.ferry.sidecar')

const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
const version = String(pkg.version || '0.0.0')

const rendererIndex = join(rootDir, 'out', 'renderer', 'index.html')
const sidecarBundle = join(rootDir, 'out', 'sidecar', 'index.cjs')
if (!existsSync(rendererIndex) || !existsSync(sidecarBundle)) {
  throw new Error('Missing built artifacts. Run "npm run build:neutralino" before packaging.')
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

if (!existsSync(join(rootDir, 'bin', 'neutralino-win_x64.exe'))) {
  runNpx(['@neutralinojs/neu', 'update'])
}

rmSync(join(distDir, 'ferry'), { recursive: true, force: true })
runNpx(['@neutralinojs/neu', 'build'])

rmSync(protoDir, { recursive: true, force: true })
mkdirSync(sidecarDistDir, { recursive: true })
copyFileSync(join(distDir, 'ferry', 'ferry-win_x64.exe'), join(protoDir, 'ferry-win_x64.exe'))
copyFileSync(join(distDir, 'ferry', 'resources.neu'), join(protoDir, 'resources.neu'))
copyFileSync(process.execPath, join(sidecarDistDir, process.platform === 'win32' ? 'node.exe' : 'node'))
copyFileSync(sidecarBundle, join(sidecarDistDir, 'index.cjs'))

const zipPath = join(distDir, `Ferry-Neutralino-${version}-win-x64.zip`)
rmSync(zipPath, { force: true })

await new Promise((resolveZip, rejectZip) => {
  const output = createWriteStream(zipPath)
  const archive = new ZipArchive({ zlib: { level: 9 } })
  output.on('close', resolveZip)
  archive.on('error', rejectZip)
  archive.pipe(output)
  archive.directory(protoDir, false)
  void archive.finalize()
})

function findMakensis() {
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
let installerPath = null
if (makensisBin) {
  execFileSync(makensisBin, [`/DVERSION=${version}`, join(rootDir, 'build', 'neutralino-installer.nsi')], {
    cwd: rootDir,
    stdio: 'inherit'
  })
  installerPath = join(distDir, `Ferry-Neutralino-Setup-${version}.exe`)
  if (existsSync(installerPath)) {
    const installerBuf = readFileSync(installerPath)
    const sha512 = createHash('sha512').update(installerBuf).digest('base64')
    const exeName = `Ferry-Neutralino-Setup-${version}.exe`
    const latestYml = `version: ${version}\nfiles:\n  - url: ${exeName}\n    sha512: ${sha512}\n    size: ${installerBuf.length}\npath: ${exeName}\nsha512: ${sha512}\nreleaseDate: '${new Date().toISOString()}'\n`
    writeFileSync(join(distDir, 'latest-neutralino.yml'), latestYml, 'utf8')
  }
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
  console.log(`Update Manifest: ${join(distDir, 'latest-neutralino.yml')}`)
  if (exeBytes > MAX_COMPRESSED_BYTES) {
    throw new Error(`NSIS installer (${exeBytes} bytes) exceeds ${MAX_COMPRESSED_BYTES} byte limit.`)
  }
} else {
  console.log('NSIS Installer: skipped (makensis not found)')
}

if (zipBytes > MAX_COMPRESSED_BYTES) {
  throw new Error(`Compressed package (${zipBytes} bytes) exceeds ${MAX_COMPRESSED_BYTES} byte limit.`)
}
