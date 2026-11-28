import { spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import * as path from 'path'
import type { Host } from '../main/host/host'
import { createSecretBox } from '../main/host/secretBox'
import { encodeLine, type WriteLine } from './protocol'

declare const __FERRY_APP_VERSION__: string | undefined

function readFallbackPackageVersion(): string {
  if (typeof __FERRY_APP_VERSION__ === 'string' && __FERRY_APP_VERSION__.length > 0) {
    return __FERRY_APP_VERSION__
  }
  try {
    const pkgPath = path.resolve(__dirname, '..', '..', 'package.json')
    const parsed = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    if (parsed.version) return String(parsed.version)
  } catch {
    // ignore in tests where __dirname layout differs
  }
  return '0.0.0'
}

export const BUNDLED_APP_VERSION = readFallbackPackageVersion()

export function createPlatformOpenPath(
  platform: NodeJS.Platform = process.platform,
  spawnProcess: typeof spawn = spawn
): Host['openPath'] {
  return async (p) => {
    if (!existsSync(p)) {
      return `Could not open ${p}: not found`
    }

    const command = platform === 'darwin'
      ? 'open'
      : platform === 'linux'
        ? 'xdg-open'
        : platform === 'win32'
          ? 'explorer.exe'
          : null

    if (!command) {
      return `Could not open ${p}: unsupported platform ${platform}`
    }

    return new Promise<string>((resolve) => {
      try {
        const child = spawnProcess(command, [p], { detached: true, stdio: 'ignore' })
        child.once('error', (error) => resolve(`Could not open ${p}: ${error.message}`))
        child.once('spawn', () => {
          child.unref()
          resolve('')
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        resolve(`Could not open ${p}: ${message}`)
      }
    })
  }
}

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
    isPackaged: process.argv.includes('--nl-mode') || process.env['FERRY_PACKAGED'] === '1',
    appVersion: process.env['FERRY_APP_VERSION'] || BUNDLED_APP_VERSION,
    openPath: createPlatformOpenPath(),
    pickOpenFile
  }
}
