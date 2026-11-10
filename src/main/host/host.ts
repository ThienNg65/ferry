export interface Host {
  broadcast(channel: string, payload: unknown): void
  isEncryptionAvailable(): boolean
  encrypt(plaintext: string): string
  decrypt(ciphertext: string): string
  readonly dataDir: string
  openPath(path: string): Promise<string>
}

let current: Host | undefined

export function setHost(h: Host): void {
  current = h
}

export function host(): Host {
  if (!current) {
    throw new Error('Host not initialised: call setHost() at process start')
  }
  return current
}
