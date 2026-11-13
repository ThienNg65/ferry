import { spawn } from 'child_process'
import { existsSync } from 'fs'
import type { Host } from '../main/host/host'
import { createSecretBox } from '../main/host/secretBox'
import { encodeLine, type WriteLine } from './protocol'

export function createNodeHost(
  key: Buffer,
  dataDir: string,
  write: WriteLine,
  pickOpenFile: Host['pickOpenFile'] = async () => null,
  broadcast: Host['broadcast'] = (channel, payload) => write(encodeLine({ event: channel, payload }))
): Host {
  const box = createSecretBox(key)
  return {
    broadcast,
    isEncryptionAvailable: () => true,
    encrypt: (plaintext) => box.encrypt(plaintext),
    decrypt: (ciphertext) => box.decrypt(ciphertext),
    dataDir,
    openPath: async (p) => {
      if (!existsSync(p)) {
        return `Could not open ${p}: not found`
      }
      spawn('explorer.exe', [p], { detached: true, stdio: 'ignore' }).unref()
      return ''
    },
    pickOpenFile
  }
}
