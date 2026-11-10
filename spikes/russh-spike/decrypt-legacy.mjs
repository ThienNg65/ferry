// Spike Task 2 (no MSVC on this machine): proves Electron safeStorage's on-disk format
// with the real user data. PowerShell unwraps the Local State key via DPAPI and pipes it
// in on stdin (never printed); this script AES-256-GCM-decrypts every saved secret.
// Usage: powershell -File unwrap-key.ps1 <userDataDir> | node decrypt-legacy.mjs <userDataDir>
import { readFileSync } from 'node:fs'
import { createDecipheriv } from 'node:crypto'

const dir = process.argv[2]
const key = Buffer.from(readFileSync(0, 'utf8').trim(), 'base64')
console.log(`key: ${key.length} bytes after DPAPI unwrap`)
if (key.length !== 32) throw new Error('expected a 32-byte AES key')

const sites = JSON.parse(readFileSync(`${dir}/sites.json`, 'utf8')).sites
let good = 0, bad = 0
sites.forEach((s, i) => {
  for (const field of ['secretPassword', 'secretPassphrase']) {
    if (!s[field]) continue
    const raw = Buffer.from(s[field], 'base64')
    const prefix = raw.subarray(0, 3).toString('latin1')
    try {
      if (prefix !== 'v10') throw new Error(`prefix ${JSON.stringify(prefix)}`)
      const nonce = raw.subarray(3, 15), tag = raw.subarray(raw.length - 16), ct = raw.subarray(15, raw.length - 16)
      const d = createDecipheriv('aes-256-gcm', key, nonce).setAuthTag(tag)
      const plain = Buffer.concat([d.update(ct), d.final()])
      good++
      console.log(`site#${i} ${field}: prefix v10, ok, ${plain.length} bytes`) // never print plaintext
    } catch (e) {
      bad++
      console.log(`site#${i} ${field}: prefix ${prefix}, FAILED: ${e.message}`)
    }
  }
})
console.log(`decrypted ${good}, failed ${bad}`)
process.exit(good > 0 && bad === 0 ? 0 : 1)
