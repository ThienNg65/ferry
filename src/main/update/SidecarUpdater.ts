import { EventEmitter } from 'events'
import { createHash } from 'crypto'
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawn } from 'child_process'
import { host } from '../host/host'

export const DEFAULT_UPDATE_FEED_URL =
  'https://github.com/ThienNg65/ferry-release/releases/latest/download'

export interface UpdateManifest {
  version: string
  path: string
  sha512: string
  size?: number
}

/** Parses standard electron-builder/neutralino `latest*.yml` fields without pulling in a YAML dependency. */
export function parseUpdateManifest(yamlText: string): UpdateManifest | null {
  const fields: Record<string, string> = {}
  for (const rawLine of yamlText.split(/\r?\n/)) {
    const match = rawLine.match(/^\s*(?:- )?([a-zA-Z0-9_]+)\s*:\s*(.+?)\s*$/)
    if (!match) continue
    const [, key, rawVal] = match
    if (!(key in fields)) {
      fields[key] = rawVal.replace(/^['"]|['"]$/g, '')
    }
  }
  const version = fields['version']?.trim()
  const installerPath = (fields['path'] || fields['url'])?.trim()
  const sha512 = fields['sha512']?.trim()
  if (!version || !installerPath || !sha512) {
    return null
  }
  const size = fields['size'] ? Number(fields['size']) : undefined
  return {
    version,
    path: installerPath,
    sha512,
    size: Number.isFinite(size) ? size : undefined
  }
}

/** Returns > 0 when `a` is strictly newer than `b` (`x.y.z[-pre]` ordering). */
export function compareSemver(a: string, b: string): number {
  const [aCore, aPre] = a.replace(/^v/, '').split('-', 2)
  const [bCore, bPre] = b.replace(/^v/, '').split('-', 2)
  const aParts = aCore.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const bParts = bCore.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const len = Math.max(aParts.length, bParts.length, 3)
  for (let i = 0; i < len; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0)
    if (diff !== 0) return diff
  }
  if (!aPre && bPre) return 1
  if (aPre && !bPre) return -1
  if (aPre && bPre) return aPre.localeCompare(bPre)
  return 0
}

export interface SidecarUpdaterDeps {
  feedUrl?: string
  downloadDir?: string
  fetchImpl?: typeof fetch
  spawnImpl?: typeof spawn
  exitImpl?: (code: number) => void
}

/**
 * GitHub-Releases updater for the standalone Neutralino sidecar runtime.
 * Mirrors the event/method contract of `electron-updater` so `AutoUpdater.ts`
 * can drive both runtimes with identical state/progress/error handling.
 */
export class SidecarUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = false
  private downloadedInstallerPath: string | null = null
  private downloadedVersion: string | null = null
  private readonly deps: Required<SidecarUpdaterDeps>

  constructor(deps: SidecarUpdaterDeps = {}) {
    super()
    this.deps = {
      feedUrl: deps.feedUrl ?? (process.env['FERRY_UPDATE_FEED_URL'] || DEFAULT_UPDATE_FEED_URL),
      downloadDir: deps.downloadDir ?? path.join(os.tmpdir(), 'ferry-updater'),
      fetchImpl: deps.fetchImpl ?? fetch,
      spawnImpl: deps.spawnImpl ?? spawn,
      exitImpl: deps.exitImpl ?? ((code) => process.exit(code))
    }
  }

  private getFeedBase(): string {
    return (process.env['FERRY_UPDATE_FEED_URL'] || this.deps.feedUrl).replace(/\/+$/, '')
  }

  private async fetchManifest(): Promise<UpdateManifest> {
    const base = this.getFeedBase()
    for (const file of ['latest-neutralino.yml', 'latest.yml']) {
      const res = await this.deps.fetchImpl(`${base}/${file}`)
      if (res.status === 404) continue
      if (!res.ok) {
        throw new Error(`Update manifest fetch failed (${res.status} ${res.statusText})`)
      }
      const parsed = parseUpdateManifest(await res.text())
      if (!parsed) {
        throw new Error(`Invalid update manifest in ${file}`)
      }
      return parsed
    }
    throw new Error('No update manifest (latest-neutralino.yml or latest.yml) found on release feed')
  }

  private async downloadAndVerify(manifest: UpdateManifest): Promise<string> {
    const safeName = path.basename(manifest.path)
    if (!safeName || safeName === '.' || safeName === '..') {
      throw new Error(`Invalid installer filename in update manifest: ${manifest.path}`)
    }
    mkdirSync(this.deps.downloadDir, { recursive: true })
    const finalPath = path.join(this.deps.downloadDir, safeName)
    const tmpPath = `${finalPath}.tmp`

    const url = /^https?:\/\//i.test(manifest.path)
      ? manifest.path
      : `${this.getFeedBase()}/${encodeURIComponent(safeName)}`
    const res = await this.deps.fetchImpl(url)
    if (!res.ok || !res.body) {
      throw new Error(`Installer download failed (${res.status} ${res.statusText})`)
    }

    const total = Number(res.headers.get('content-length')) || manifest.size || 0
    const hash = createHash('sha512')
    const fileStream = createWriteStream(tmpPath)
    let transferred = 0
    const startedAt = Date.now()
    const reader = res.body.getReader()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const buf = Buffer.from(value)
        hash.update(buf)
        transferred += buf.length
        if (!fileStream.write(buf)) {
          await new Promise<void>((resolve) => fileStream.once('drain', resolve))
        }
        const elapsedSec = Math.max(0.001, (Date.now() - startedAt) / 1000)
        this.emit('download-progress', {
          percent: total > 0 ? Math.min(100, (transferred / total) * 100) : 0,
          bytesPerSecond: Math.round(transferred / elapsedSec),
          transferred,
          total
        })
      }
      await new Promise<void>((resolve, reject) => {
        fileStream.on('error', reject)
        fileStream.end(resolve)
      })
    } catch (err) {
      fileStream.destroy()
      rmSync(tmpPath, { force: true })
      throw err
    }

    const actualSha512 = hash.digest('base64')
    if (actualSha512 !== manifest.sha512) {
      rmSync(tmpPath, { force: true })
      throw new Error(`SHA-512 verification failed for ${safeName}`)
    }

    rmSync(finalPath, { force: true })
    renameSync(tmpPath, finalPath)
    return finalPath
  }

  async checkForUpdates(): Promise<{ updateInfo: { version: string } }> {
    this.emit('checking-for-update')
    try {
      const manifest = await this.fetchManifest()
      const currentVersion = host().appVersion ?? '0.22.0'
      if (compareSemver(manifest.version, currentVersion) <= 0) {
        this.emit('update-not-available', { version: currentVersion })
        return { updateInfo: { version: currentVersion } }
      }

      this.emit('update-available', { version: manifest.version })
      if (this.autoDownload) {
        this.downloadedInstallerPath = await this.downloadAndVerify(manifest)
        this.downloadedVersion = manifest.version
        this.emit('update-downloaded', { version: manifest.version })
      }
      return { updateInfo: { version: manifest.version } }
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }

  quitAndInstall(isSilent = true): void {
    const installerPath = this.downloadedInstallerPath
    if (!installerPath || !existsSync(installerPath)) {
      throw new Error('No verified update installer is ready to launch')
    }
    const args = isSilent ? ['/S'] : []
    const child = this.deps.spawnImpl(installerPath, args, {
      detached: true,
      stdio: 'ignore'
    })
    child.unref()
    this.deps.exitImpl(0)
  }

  getDownloadedInfo(): { version: string | null; installerPath: string | null } {
    return { version: this.downloadedVersion, installerPath: this.downloadedInstallerPath }
  }
}

let singleton: SidecarUpdater | null = null

export function getSidecarUpdater(): SidecarUpdater {
  if (!singleton) {
    singleton = new SidecarUpdater()
  }
  return singleton
}
