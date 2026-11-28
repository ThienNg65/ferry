#!/usr/bin/env node
// Builds the native macOS shell into a universal, sandboxed Ferry.app (Mac App Store layout).
//   node scripts/pack-macos.mjs [--sign <identity>] [--skip-build] [--out <dir>]
// Default signing is ad-hoc ("-"), which is enough to run the sandbox locally. A real
// "3rd Party Mac Developer Application" identity and productbuild are Phase 3.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = (flag, fallback) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback)
const identity = argValue('--sign', '-')
const outDir = resolve(root, argValue('--out', 'dist/macos'))
const skipBuild = args.includes('--skip-build')

// Official standalone Node (statically bundled deps). Homebrew's dynamic build crashes in the sandbox.
const NODE_VERSION = '22.23.5'
const NODE_CACHE = join(root, '.cache', 'node', `v${NODE_VERSION}`)

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = String(pkg.version)
const buildNumber = process.env.FERRY_BUILD_NUMBER || version

const run = (cmd, cmdArgs, opts = {}) => execFileSync(cmd, cmdArgs, { stdio: 'inherit', cwd: root, ...opts })
const out = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8' }).trim()

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`)
  await pipeline(res.body, createWriteStream(dest))
}

async function nodeBinary(arch) {
  const name = `node-v${NODE_VERSION}-darwin-${arch}`
  const bin = join(NODE_CACHE, name, 'bin', 'node')
  if (existsSync(bin)) return bin
  mkdirSync(NODE_CACHE, { recursive: true })
  const base = `https://nodejs.org/dist/v${NODE_VERSION}`
  const tarball = join(NODE_CACHE, `${name}.tar.gz`)
  const sums = join(NODE_CACHE, 'SHASUMS256.txt')
  await download(`${base}/SHASUMS256.txt`, sums)
  await download(`${base}/${name}.tar.gz`, tarball)
  const line = readFileSync(sums, 'utf8').split('\n').find((l) => l.endsWith(`  ${name}.tar.gz`))
  if (!line) throw new Error(`No checksum listed for ${name}.tar.gz`)
  const actual = createHash('sha256').update(readFileSync(tarball)).digest('hex')
  if (actual !== line.split(/\s+/)[0]) throw new Error(`Checksum mismatch for ${name}.tar.gz`)
  run('tar', ['-xzf', tarball, '-C', NODE_CACHE])
  return bin
}

function buildIcns(dest) {
  const iconset = join(outDir, 'Ferry.iconset')
  rmSync(iconset, { recursive: true, force: true })
  mkdirSync(iconset, { recursive: true })
  const src = join(root, 'resources', '1024x1024.png')
  for (const size of [16, 32, 128, 256, 512]) {
    run('sips', ['-z', String(size), String(size), src, '--out', join(iconset, `icon_${size}x${size}.png`)], { stdio: 'ignore' })
    run('sips', ['-z', String(size * 2), String(size * 2), src, '--out', join(iconset, `icon_${size}x${size}@2x.png`)], { stdio: 'ignore' })
  }
  run('iconutil', ['-c', 'icns', iconset, '-o', dest])
  rmSync(iconset, { recursive: true, force: true })
}

if (process.platform !== 'darwin') throw new Error('pack-macos must run on macOS')

if (!skipBuild) {
  run('npm', ['run', 'build'])
  // One build per architecture (works with just the Command Line Tools), merged with lipo below.
  for (const triple of ['arm64-apple-macosx12.0', 'x86_64-apple-macosx12.0']) {
    run('swift', ['build', '-c', 'release', '--triple', triple], { cwd: join(root, 'macos') })
  }
}

const shellBin = join(outDir, 'Ferry-universal')
mkdirSync(outDir, { recursive: true })
run('lipo', [
  '-create',
  join(root, 'macos', '.build', 'arm64-apple-macosx', 'release', 'Ferry'),
  join(root, 'macos', '.build', 'x86_64-apple-macosx', 'release', 'Ferry'),
  '-output',
  shellBin
])

const app = join(outDir, 'Ferry.app')
rmSync(app, { recursive: true, force: true })
const macos = join(app, 'Contents', 'MacOS')
const resources = join(app, 'Contents', 'Resources')
mkdirSync(macos, { recursive: true })
mkdirSync(resources, { recursive: true })

cpSync(shellBin, join(macos, 'Ferry'))
rmSync(shellBin)
cpSync(join(root, 'out', 'renderer'), join(resources, 'renderer'), { recursive: true })
cpSync(join(root, 'out', 'sidecar', 'index.cjs'), join(resources, 'sidecar.cjs'))

const arm = await nodeBinary('arm64')
const x64 = await nodeBinary('x64')
const nodeOut = join(resources, 'node')
run('lipo', ['-create', arm, x64, '-output', nodeOut])
chmodSync(nodeOut, 0o755)

buildIcns(join(resources, 'Ferry.icns'))

const plist = readFileSync(join(root, 'build', 'mas', 'Info.plist.template'), 'utf8')
  .replaceAll('{{VERSION}}', version)
  .replaceAll('{{BUILD}}', buildNumber)
writeFileSync(join(app, 'Contents', 'Info.plist'), plist)

// Inside-out signing: helpers first (child entitlements), then the app. Never --deep.
const sign = (target, entitlements) =>
  run('codesign', ['--force', '--sign', identity, '--timestamp=none', '--entitlements', entitlements, target])
sign(nodeOut, join(root, 'build', 'mas', 'child.entitlements'))
sign(app, join(root, 'build', 'mas', 'parent.entitlements'))

console.log(`\nBuilt ${app}`)
console.log(`  version ${version} (${buildNumber}), signed with ${identity === '-' ? 'ad-hoc identity' : identity}`)
console.log(`  shell:  ${out('lipo', ['-archs', join(macos, 'Ferry')])}`)
console.log(`  node:   ${out('lipo', ['-archs', nodeOut])}`)
