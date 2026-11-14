import { EventEmitter } from 'events'
import { createHash } from 'crypto'
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawn } from 'child_process'
import { host } from '../host/host'
import { logSecurityEvent } from '../host/securityLog'

export const DEFAULT_UPDATE_FEED_URL =
  'https://github.com/ThienNg65/ferry-release/releases/latest/download'
export const UPDATE_MANIFEST_FILE = 'latest.yml'

export function isFerryInstallerName(fileName: string): boolean {
  return /^Ferry-Setup-[A-Za-z0-9._-]+\.exe$/i.test(fileName)
}

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
  manifestTimeoutMs?: number
  downloadIdleTimeoutMs?: number
}

const DEFAULT_MANIFEST_TIMEOUT_MS = 15_000
const DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS = 30_000

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
      exitImpl: deps.exitImpl ?? ((code) => process.exit(code)),
      manifestTimeoutMs: deps.manifestTimeoutMs ?? DEFAULT_MANIFEST_TIMEOUT_MS,
      downloadIdleTimeoutMs: deps.downloadIdleTimeoutMs ?? DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS
    }
  }

  private getFeedBase(): string {
    const raw = (process.env['FERRY_UPDATE_FEED_URL'] || this.deps.feedUrl).replace(/\/+$/, '')
    let parsed: URL
    try {
      parsed = new URL(raw)
    } catch {
      logSecurityEvent('updater.invalid_feed_url', { url: raw })
      throw new Error(`Invalid update feed URL: ${raw}`)
    }
    const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
    const allowInsecureLocal = !host().isPackaged && isLoopback
    if (parsed.protocol !== 'https:' && !allowInsecureLocal) {
      logSecurityEvent('updater.insecure_feed_url', { url: raw })
      throw new Error(`Refusing insecure non-HTTPS update feed URL: ${raw}`)
    }
    return raw
  }

  private resolveInstallerUrl(manifestPath: string, safeName: string): string {
    const feedBase = this.getFeedBase()
    if (!/^https?:\/\//i.test(manifestPath)) {
      return `${feedBase}/${encodeURIComponent(safeName)}`
    }
    let parsed: URL
    try {
      parsed = new URL(manifestPath)
    } catch {
      logSecurityEvent('updater.invalid_installer_url', { url: manifestPath })
      throw new Error(`Invalid installer URL in update manifest: ${manifestPath}`)
    }
    const feedOrigin = new URL(feedBase).origin
    const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
    const allowInsecureLocal = !host().isPackaged && isLoopback
    if (parsed.protocol !== 'https:' && !allowInsecureLocal) {
      logSecurityEvent('updater.insecure_installer_url', { url: manifestPath })
      throw new Error(`Refusing insecure non-HTTPS installer URL: ${manifestPath}`)
    }
    const trustedGitHubHost =
      parsed.hostname === 'github.com' ||
      parsed.hostname === 'objects.githubusercontent.com' ||
      parsed.hostname === 'release-assets.githubusercontent.com'
    if (parsed.origin !== feedOrigin && !trustedGitHubHost) {
      logSecurityEvent('updater.untrusted_installer_origin', { url: manifestPath, feedOrigin })
      throw new Error(`Refusing untrusted installer origin in update manifest: ${parsed.origin}`)
    }
    return parsed.toString()
  }

  private async fetchManifest(): Promise<UpdateManifest> {
    const base = this.getFeedBase()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error(`Update manifest request timed out after ${this.deps.manifestTimeoutMs}ms`)), this.deps.manifestTimeoutMs)
    let manifestText: string
    try {
      const res = await this.deps.fetchImpl(`${base}/${UPDATE_MANIFEST_FILE}`, { signal: controller.signal })
      if (res.status === 404) {
        throw new Error(`No update manifest (${UPDATE_MANIFEST_FILE}) found on release feed`)
      }
      if (!res.ok) {
        throw new Error(`Update manifest fetch failed (${res.status} ${res.statusText})`)
      }
      manifestText = await res.text()
    } finally {
      clearTimeout(timer)
    }
    const parsed = parseUpdateManifest(manifestText)
    if (!parsed) {
      throw new Error(`Invalid update manifest in ${UPDATE_MANIFEST_FILE}`)
    }
    const safeName = path.basename(parsed.path)
    if (!isFerryInstallerName(safeName)) {
      throw new Error(`Refusing unexpected installer in update manifest: ${safeName}`)
    }
    return parsed
  }

  private async downloadAndVerify(manifest: UpdateManifest): Promise<string> {
    const safeName = path.basename(manifest.path)
    if (!isFerryInstallerName(safeName)) {
      throw new Error(`Invalid installer filename in update manifest: ${manifest.path}`)
    }
    mkdirSync(this.deps.downloadDir, { recursive: true })
    const finalPath = path.join(this.deps.downloadDir, safeName)
    const tmpPath = `${finalPath}.tmp`

    const url = this.resolveInstallerUrl(manifest.path, safeName)

    const controller = new AbortController()
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    const armIdleTimer = (): void => {
      if (idleTimer !== null) clearTimeout(idleTimer)
      idleTimer = setTimeout(
        () => controller.abort(new Error(`Installer download stalled for ${this.deps.downloadIdleTimeoutMs}ms`)),
        this.deps.downloadIdleTimeoutMs
      )
    }
    const clearIdleTimer = (): void => {
      if (idleTimer !== null) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
    }

    armIdleTimer()
    let res: Response
    try {
      res = await this.deps.fetchImpl(url, { signal: controller.signal })
    } catch (err) {
      clearIdleTimer()
      throw err
    }
    if (!res.ok || !res.body) {
      clearIdleTimer()
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
        armIdleTimer()
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
      clearIdleTimer()
      await new Promise<void>((resolve, reject) => {
        fileStream.on('error', reject)
        fileStream.end(resolve)
      })
    } catch (err) {
      clearIdleTimer()
      await new Promise<void>((resolve) => {
        if (fileStream.closed) {
          resolve()
          return
        }
        fileStream.once('close', () => resolve())
        fileStream.destroy()
      })
      try {
        rmSync(tmpPath, { force: true })
      } catch {
        // Never mask the original download error with a cleanup error.
      }
      throw err
    }

    const actualSha512 = hash.digest('base64')
    if (actualSha512 !== manifest.sha512) {
      rmSync(tmpPath, { force: true })
      logSecurityEvent('updater.sha512_mismatch', { file: safeName, expected: manifest.sha512, actual: actualSha512 })
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

  quitAndInstall(isSilent = true, isForceRunAfter = true): void {
    const installerPath = this.downloadedInstallerPath
    if (!installerPath || !existsSync(installerPath)) {
      throw new Error('No verified update installer is ready to launch')
    }
    const args = ['--updated']
    if (isSilent) {
      args.push('/S')
    }
    if (isForceRunAfter) {
      args.push('--force-run')
    }
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
