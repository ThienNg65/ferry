import { SshError } from '../ssh/errors'
import { host } from './host'

export function encrypt(plaintext: string | undefined): string | undefined {
  if (!plaintext) {
    return undefined
  }
  if (!host().isEncryptionAvailable()) {
    throw new SshError('AUTH', 'OS credential encryption is unavailable on this machine')
  }
  return host().encrypt(plaintext)
}

export function decrypt(ciphertext: string | undefined): string | undefined {
  if (!ciphertext) {
    return undefined
  }
  if (!host().isEncryptionAvailable()) {
    throw new SshError('AUTH', 'OS credential encryption is unavailable on this machine — saved secrets cannot be decrypted')
  }
  try {
    return host().decrypt(ciphertext)
  } catch (e) {
    throw new SshError('AUTH', `Could not decrypt a saved secret: ${e instanceof Error ? e.message : String(e)}`)
  }
}
