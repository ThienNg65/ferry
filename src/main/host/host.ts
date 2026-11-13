export interface OpenFileOptions {
  filters?: { name: string; extensions: string[] }[]
}

export interface Host {
  broadcast(channel: string, payload: unknown): void
  isEncryptionAvailable(): boolean
  encrypt(plaintext: string): string
  decrypt(ciphertext: string): string
  readonly dataDir: string
  openPath(path: string): Promise<string>
  pickOpenFile(options?: OpenFileOptions): Promise<string | null>
}

const g = globalThis as typeof globalThis & { __ferryHost?: Host }

export function setHost(h: Host): void {
  g.__ferryHost = h
}

export function host(): Host {
  if (!g.__ferryHost) {
    throw new Error('Host not initialised: call setHost() at process start')
  }
  return g.__ferryHost
}
