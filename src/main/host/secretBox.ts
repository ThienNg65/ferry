import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const PREFIX = Buffer.from('v10')
const NONCE_BYTES = 12
const TAG_BYTES = 16

export interface SecretBox {
  encrypt(plaintext: string): string
  decrypt(ciphertext: string): string
}

export function createSecretBox(key: Buffer): SecretBox {
  if (key.length !== 32) {
    throw new Error(`secret key must be 32 bytes, got ${key.length}`)
  }
  return {
    encrypt(plaintext) {
      const nonce = randomBytes(NONCE_BYTES)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      return Buffer.concat([PREFIX, nonce, body, cipher.getAuthTag()]).toString('base64')
    },
    decrypt(ciphertext) {
      const raw = Buffer.from(ciphertext, 'base64')
      if (raw.length < PREFIX.length + NONCE_BYTES + TAG_BYTES || !raw.subarray(0, PREFIX.length).equals(PREFIX)) {
        throw new Error('unsupported ciphertext format')
      }
      const nonce = raw.subarray(PREFIX.length, PREFIX.length + NONCE_BYTES)
      const tag = raw.subarray(raw.length - TAG_BYTES)
      const body = raw.subarray(PREFIX.length + NONCE_BYTES, raw.length - TAG_BYTES)
      const decipher = createDecipheriv('aes-256-gcm', key, nonce).setAuthTag(tag)
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
    }
  }
}
