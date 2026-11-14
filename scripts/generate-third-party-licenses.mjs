import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')

const lock = JSON.parse(readFileSync(join(rootDir, 'package-lock.json'), 'utf8'))
const rootPkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))

const BUNDLED_UI_ROOTS = [
  '@nuxt/ui',
  '@iconify-json/lucide',
  '@iconify/vue',
  '@tanstack/vue-virtual',
  '@xterm/xterm',
  '@xterm/addon-fit',
  'pinia',
  'vue'
]

function findLockKey(pkgName, parentKey) {
  if (parentKey) {
    const nested = `${parentKey}/node_modules/${pkgName}`
    if (lock.packages?.[nested]) return nested
  }
  const top = `node_modules/${pkgName}`
  return lock.packages?.[top] ? top : null
}

function collectBundledLockKeys() {
  const roots = Array.from(new Set([...Object.keys(rootPkg.dependencies || {}), ...BUNDLED_UI_ROOTS]))
  const visited = new Set()
  const queue = roots.map((name) => findLockKey(name, '')).filter(Boolean)

  while (queue.length > 0) {
    const key = queue.shift()
    if (!key || visited.has(key)) continue
    const entry = lock.packages?.[key]
    if (!entry) continue
    visited.add(key)

    const deps = { ...(entry.dependencies || {}), ...(entry.peerDependencies || {}) }
    for (const depName of Object.keys(deps)) {
      const depKey = findLockKey(depName, key)
      if (depKey && !visited.has(depKey)) queue.push(depKey)
    }
  }
  return Array.from(visited).sort()
}

function readPkgMeta(lockKey) {
  const pkgDir = join(rootDir, lockKey)
  const pkgName = lockKey.replace(/^.*node_modules\//, '')
  const pkgJsonPath = join(pkgDir, 'package.json')
  const pkgJson = existsSync(pkgJsonPath) ? JSON.parse(readFileSync(pkgJsonPath, 'utf8')) : null
  const lockEntry = lock.packages?.[lockKey] || {}
  const version = pkgJson?.version || lockEntry.version || 'unknown'

  let license = pkgJson?.license || lockEntry.license || null
  if (!license && Array.isArray(pkgJson?.licenses) && pkgJson.licenses.length > 0) {
    license = pkgJson.licenses.map((l) => l.type || l.name).filter(Boolean).join(', ')
  }

  let licenseFile = null
  if (existsSync(pkgDir)) {
    licenseFile = readdirSync(pkgDir).find((f) => /^(license|copying|notice)(\.|$)/i.test(f)) || null
  }
  if (!license && pkgName === 'vaul-vue') {
    license = 'MIT-derived (Re-export of Reka UI / Vaul; package.json omits license field)'
  }

  const infoPath = join(pkgDir, 'info.json')
  const infoJson = existsSync(infoPath) ? JSON.parse(readFileSync(infoPath, 'utf8')) : null
  const author =
    typeof pkgJson?.author === 'string'
      ? pkgJson.author
      : pkgJson?.author?.name || infoJson?.author?.name || ''

  return {
    name: pkgName,
    version,
    license: license || 'UNSPECIFIED',
    author,
    repository: typeof pkgJson?.repository === 'string' ? pkgJson.repository : pkgJson?.repository?.url || '',
    licenseText: licenseFile ? readFileSync(join(pkgDir, licenseFile), 'utf8').trim() : null
  }
}

function collectLockAudit() {
  const counts = new Map()
  const unspecified = []
  const copyleft = []
  for (const [key, entry] of Object.entries(lock.packages || {})) {
    if (!key) continue
    const pkgName = key.replace(/^.*node_modules\//, '')
    let lic = entry.license
    if (!lic) {
      const pkgJsonPath = join(rootDir, key, 'package.json')
      if (existsSync(pkgJsonPath)) {
        const pj = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
        lic = pj.license || (Array.isArray(pj.licenses) ? pj.licenses.map((l) => l.type).join(', ') : null)
      }
    }
    const label = lic || 'UNSPECIFIED'
    counts.set(label, (counts.get(label) || 0) + 1)
    if (!lic) {
      unspecified.push(`${pkgName} (${entry.optional ? 'optional/not installed' : entry.dev ? 'dev/UI transitive' : 'runtime'})`)
    }
    if (/\b(GPL|AGPL|LGPL|MPL|EPL|CDDL)\b/i.test(label)) {
      copyleft.push({ name: pkgName, license: label, dev: Boolean(entry.dev) })
    }
  }
  return { counts: Object.fromEntries(counts), unspecified, copyleft }
}

const bundledKeys = collectBundledLockKeys()
const shipped = bundledKeys.map(readPkgMeta)
const audit = collectLockAudit()

const lines = [
  'FERRY THIRD-PARTY LICENSES & ASSET NOTICES',
  '==========================================',
  '',
  `Generated for Ferry v${rootPkg.version} (MIT License).`,
  '',
  '1. ASSET & FONT LICENSES',
  '------------------------',
  '- Screenshots in public/ and application icons in resources/ are project-owned assets.',
  '- UI & terminal typography use OS-installed system fonts (Segoe UI, SF Pro, Cascadia Code, Consolas); no third-party font files are bundled or downloaded.',
  '',
  '2. BUNDLED RUNTIMES (WINDOWS DISTRIBUTION)',
  '------------------------------------------',
  '- Neutralinojs (ferry-win_x64.exe) — MIT License (https://github.com/neutralinojs/neutralinojs)',
  '- Node.js (node.exe) — MIT / OpenJS Foundation License (https://github.com/nodejs/node)',
  '- WebView2 Runtime — Microsoft Edge WebView2 (provided by Windows OS)',
  '',
  '3. DEPENDENCY LICENSE SUMMARY (package-lock.json)',
  '-------------------------------------------------',
  ...Object.entries(audit.counts).map(([lic, count]) => `- ${lic}: ${count}`),
  '',
  'Packages without an SPDX license field in package-lock.json:',
  ...audit.unspecified.map((u) => `  - ${u}`),
  '- Note: cpu-features and buildcheck are optional native addons for ssh2 that are not installed on disk and not bundled into out/sidecar/index.cjs.',
  ...(audit.copyleft.length > 0
    ? [
        '',
        'Weak-copyleft / Copyleft packages in lockfile:',
        ...audit.copyleft.map((c) => `  - ${c.name}: ${c.license} (${c.dev ? 'dev/build-only' : 'runtime'})`)
      ]
    : []),
  '',
  `4. BUNDLED RUNTIME & UI PACKAGE NOTICES (${shipped.length} packages)`,
  '-------------------------------------------------------------------',
  ''
]

for (const pkg of shipped) {
  lines.push(`--- ${pkg.name}@${pkg.version} (${pkg.license}) ---`)
  if (pkg.author) lines.push(`Author: ${pkg.author}`)
  if (pkg.repository) lines.push(`Repository: ${pkg.repository}`)
  if (pkg.licenseText) {
    lines.push('')
    lines.push(pkg.licenseText)
  }
  lines.push('')
}

const outPath = join(rootDir, 'THIRD_PARTY_LICENSES.txt')
writeFileSync(outPath, lines.join('\n'), 'utf8')
console.log(`Wrote ${outPath} (${shipped.length} bundled packages)`)
