import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { execFileSync, spawn } from 'child_process'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const sidecarDir = join(rootDir, 'extensions', 'js.ferry.sidecar')

function runNpm(args) {
  if (process.platform === 'win32') {
    execFileSync('cmd.exe', ['/d', '/c', 'npm.cmd', ...args], { cwd: rootDir, stdio: 'inherit' })
  } else {
    execFileSync('npm', args, { cwd: rootDir, stdio: 'inherit' })
  }
}

function runNpx(args) {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/d', '/c', 'npx.cmd', '--registry=https://registry.npmjs.org', ...args], {
      cwd: rootDir,
      stdio: 'inherit'
    })
  }
  return spawn('npx', ['--registry=https://registry.npmjs.org', ...args], { cwd: rootDir, stdio: 'inherit' })
}

runNpm(['run', 'build'])

const nlConfig = JSON.parse(readFileSync(join(rootDir, 'neutralino.config.json'), 'utf8'))
const expectedNlVersion = String(nlConfig.cli?.binaryVersion || '')
const nlVersionMarker = join(rootDir, 'bin', '.ferry-nl-version')
const cachedNlVersion = existsSync(nlVersionMarker) ? readFileSync(nlVersionMarker, 'utf8').trim() : ''

if (!existsSync(join(rootDir, 'bin', 'neutralino-win_x64.exe')) || cachedNlVersion !== expectedNlVersion) {
  if (process.platform === 'win32') {
    execFileSync('cmd.exe', ['/d', '/c', 'npx.cmd', '--registry=https://registry.npmjs.org', '@neutralinojs/neu', 'update'], {
      cwd: rootDir,
      stdio: 'inherit'
    })
  } else {
    execFileSync('npx', ['--registry=https://registry.npmjs.org', '@neutralinojs/neu', 'update'], {
      cwd: rootDir,
      stdio: 'inherit'
    })
  }
  mkdirSync(join(rootDir, 'bin'), { recursive: true })
  writeFileSync(nlVersionMarker, expectedNlVersion, 'utf8')
}

mkdirSync(sidecarDir, { recursive: true })
copyFileSync(process.execPath, join(sidecarDir, process.platform === 'win32' ? 'node.exe' : 'node'))
copyFileSync(join(rootDir, 'out', 'sidecar', 'index.cjs'), join(sidecarDir, 'index.cjs'))

const child = runNpx(['@neutralinojs/neu', 'run'])
child.on('exit', (code) => process.exit(code ?? 0))
