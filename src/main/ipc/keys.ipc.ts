import { handle } from './envelope'
import { optionalString, requireNonEmptyString, requireObject } from './validation'
import { generateEd25519KeyPair } from '../ssh/KeyGenerator'
import { SshError } from '../ssh/errors'
import { INVOKE_CHANNELS, type KeyGenerateResult } from '../../shared/contract'

/** Registers SSH keypair generation handlers. */
export function registerKeysHandlers(): void {
  handle<KeyGenerateResult>(INVOKE_CHANNELS.keysGenerate, async (req) => {
    const obj = requireObject(req, INVOKE_CHANNELS.keysGenerate)
    const keyPath = requireNonEmptyString(obj.keyPath, 'keyPath', INVOKE_CHANNELS.keysGenerate)
    const passphrase = optionalString(obj.passphrase, 'passphrase', INVOKE_CHANNELS.keysGenerate)
    const comment = optionalString(obj.comment, 'comment', INVOKE_CHANNELS.keysGenerate)
    if (comment && /[\r\n]/.test(comment)) {
      throw new SshError('VALIDATION', 'Key comment cannot contain line breaks')
    }
    const payload = {
      keyPath,
      ...(passphrase !== undefined ? { passphrase } : {}),
      ...(comment !== undefined ? { comment } : {})
    }
    return generateEd25519KeyPair(payload)
  })
}
