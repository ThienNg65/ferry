import { tmpdir } from 'os'
import { join } from 'path'
import { setHost, type Host } from './host'

export const testHost: Host = {
  broadcast: () => {},
  isEncryptionAvailable: () => true,
  encrypt: (plaintext) => Buffer.from(`ENC:${plaintext}`).toString('base64'),
  decrypt: (ciphertext) => {
    const text = Buffer.from(ciphertext, 'base64').toString()
    if (!text.startsWith('ENC:')) {
      throw new Error('bad ciphertext')
    }
    return text.slice('ENC:'.length)
  },
  dataDir: join(tmpdir(), 'ferry-vitest'),
  openPath: async () => '',
  pickOpenFile: async () => null
}

setHost(testHost)
