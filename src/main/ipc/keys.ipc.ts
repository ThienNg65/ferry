import { handle } from './envelope'
import { generateEd25519KeyPair } from '../ssh/KeyGenerator'
import { INVOKE_CHANNELS, type KeyGenerateRequest, type KeyGenerateResult } from '../../shared/contract'

/** Registers SSH keypair generation handlers. */
export function registerKeysHandlers(): void {
  handle<KeyGenerateResult>(INVOKE_CHANNELS.keysGenerate, async (req) => {
    return generateEd25519KeyPair(req as KeyGenerateRequest)
  })
}
