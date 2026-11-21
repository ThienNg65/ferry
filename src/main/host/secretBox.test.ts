import { createCipheriv, randomBytes } from 'crypto'
import { describe, expect, it } from 'vitest'
import { createSecretBox } from './secretBox'

const key = randomBytes(32)

function v10Ciphertext(plaintext: string): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([Buffer.from('v10'), nonce, body, cipher.getAuthTag()]).toString('base64')
}

describe('createSecretBox', () => {
  const box = createSecretBox(key)

  it('decrypts a ciphertext in v10 AES-256-GCM layout', () => {
    expect(box.decrypt(v10Ciphertext('hunter2 ünïcode'))).toBe('hunter2 ünïcode')
  })

  it('round-trips and writes the v10 prefix', () => {
    const ciphertext = box.encrypt('s3cret')
    expect(Buffer.from(ciphertext, 'base64').subarray(0, 3).toString()).toBe('v10')
    expect(box.decrypt(ciphertext)).toBe('s3cret')
  })

  it('uses a fresh nonce per encryption', () => {
    expect(box.encrypt('same')).not.toBe(box.encrypt('same'))
  })

  it('rejects a tampered auth tag', () => {
    const raw = Buffer.from(box.encrypt('s3cret'), 'base64')
    raw[raw.length - 1] ^= 0xff
    expect(() => box.decrypt(raw.toString('base64'))).toThrow()
  })

  it('rejects another prefix', () => {
    const raw = Buffer.from(v10Ciphertext('x'), 'base64')
    raw.write('v20', 0)
    expect(() => box.decrypt(raw.toString('base64'))).toThrow('unsupported ciphertext format')
  })

  it('rejects a ciphertext made with a different key', () => {
    expect(() => createSecretBox(randomBytes(32)).decrypt(box.encrypt('s3cret'))).toThrow()
  })

  it('refuses a key that is not 32 bytes', () => {
    expect(() => createSecretBox(randomBytes(16))).toThrow('32 bytes')
  })
})
