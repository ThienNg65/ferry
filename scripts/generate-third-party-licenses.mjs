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
  '- Bundled variable fonts in src/renderer/src/assets/fonts/ (PlusJakartaSans-Variable.woff2, JetBrainsMono-Variable.woff2) are distributed offline under the SIL Open Font License 1.1 (OFL-1.1); OS system fonts (Cascadia Code, Segoe UI Variable, SF Pro, Consolas) serve as local fallbacks with zero external font requests.',
  '',
  '--- Plus Jakarta Sans Variable (SIL OFL-1.1) ---',
  'Copyright 2020 The Plus Jakarta Sans Project Authors (https://github.com/tokotype/PlusJakartaSans)',
  '',
  '--- JetBrains Mono Variable (SIL OFL-1.1) ---',
  'Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)',
  '',
  'SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007',
  '-----------------------------------------------------------',
  'PREAMBLE',
  'The goals of the Open Font License (OFL) are to stimulate worldwide',
  'development of collaborative font projects, to support the font creation',
  'efforts of academic and linguistic communities, and to provide a free and',
  'open framework in which fonts may be shared and improved in partnership',
  'with others.',
  '',
  'The OFL allows the licensed fonts to be used, studied, modified and',
  'redistributed freely as long as they are not sold by themselves. The',
  'fonts, including any derivative works, can be bundled, embedded,',
  'redistributed and/or sold with any software provided that any reserved',
  'names are not used by derivative works. The fonts and derivatives,',
  'however, cannot be released under any other type of license. The',
  'requirement for fonts to remain under this license does not apply',
  'to any document created using the fonts or their derivatives.',
  '',
  'DEFINITIONS',
  '"Font Software" refers to the set of files released by the Copyright',
  'Holder(s) under this license and clearly marked as such. This may',
  'include source files, build scripts and documentation.',
  '',
  '"Reserved Font Name" refers to any names specified as such after the',
  'copyright statement(s).',
  '',
  '"Original Version" refers to the collection of Font Software components as',
  'distributed by the Copyright Holder(s).',
  '',
  '"Modified Version" refers to any derivative made by adding to, deleting,',
  'or substituting -- in part or in whole -- any of the components of the',
  'Original Version, by changing formats or by porting the Font Software to a',
  'new environment.',
  '',
  '"Author" refers to any designer, engineer, programmer, technical',
  'writer or other person who contributed to the Font Software.',
  '',
  'PERMISSION & CONDITIONS',
  'Permission is hereby granted, free of charge, to any person obtaining',
  'a copy of the Font Software, to use, study, copy, merge, embed, modify,',
  'redistribute, and sell modified and unmodified copies of the Font',
  'Software, subject to the following conditions:',
  '',
  '1) Neither the Font Software nor any of its individual components,',
  'in Original or Modified Versions, may be sold by itself.',
  '',
  '2) Original or Modified Versions of the Font Software may be bundled,',
  'redistributed and/or sold with any software, provided that each copy',
  'contains the above copyright notice and this license. These can be',
  'included either as stand-alone text files, human-readable headers or',
  'in the appropriate machine-readable metadata fields within text or',
  'binary files as long as those fields can be easily viewed by the user.',
  '',
  '3) No Modified Version of the Font Software may use the Reserved Font',
  'Name(s) unless explicit written permission is granted by the corresponding',
  'Copyright Holder. This restriction only applies to the primary font name as',
  'presented to the users.',
  '',
  '4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font',
  'Software shall not be used to promote, endorse or advertise any',
  'Modified Version, except to acknowledge the contribution(s) of the',
  'Copyright Holder(s) and the Author(s) or with their explicit written',
  'permission.',
  '',
  '5) The Font Software, modified or unmodified, in part or in whole,',
  'must be distributed entirely under this license, and must not be',
  'distributed under any other license. The requirement for fonts to',
  'remain under this license does not apply to any document created',
  'using the Font Software.',
  '',
  'TERMINATION',
  'This license becomes null and void if any of the above conditions are',
  'not met.',
  '',
  'DISCLAIMER',
  'THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,',
  'EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF',
  'MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT',
  'OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE',
  'COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,',
  'INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL',
  'DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING',
  'FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM',
  'OTHER DEALINGS IN THE FONT SOFTWARE.',
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
