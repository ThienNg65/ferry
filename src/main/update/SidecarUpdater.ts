import { EventEmitter } from 'events'
import { createHash } from 'crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, type WriteStream } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawn, type ChildProcess } from 'child_process'
import { host } from '../host/host'
import { logSecurityEvent } from '../host/securityLog'

export const DEFAULT_UPDATE_FEED_URL =
  'https://github.com/ThienNg65/ferry-release/releases/latest/download'
export const UPDATE_MANIFEST_FILE = 'latest.yml'
export const FALLBACK_APP_VERSION = '0.0.0'

const TRUSTED_GITHUB_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
])

export function isFerryInstallerName(fileName: string): boolean {
  return /^Ferry-Setup-[A-Za-z0-9._-]+\.exe$/i.test(fileName)
}

export function isValidSha512Base64(value: string): boolean {
  return /^[A-Za-z0-9+/]{86}==$/.test(value) && Buffer.from(value, 'base64').length === 64
}

export interface UpdateManifest {
  version: string
  path: string
  sha512: string
  size?: number
}

interface ParsedManifestEntry {
  path?: string
  url?: string
  sha512?: string
  size?: number
}

function unquoteYamlScalar(raw: string): string {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed.replace(/\s+#.*$/, '').trim()
}

function assignManifestField(target: ParsedManifestEntry, key: string, value: string): void {
  if (key === 'path' && target.path === undefined) {
    target.path = value
  } else if (key === 'url' && target.url === undefined) {
    target.url = value
  } else if (key === 'sha512' && target.sha512 === undefined) {
    target.sha512 = value
  } else if (key === 'size' && target.size === undefined) {
    const num = Number(value)
    if (Number.isFinite(num)) {
      target.size = num
    }
  }
}

/** Parses standard electron-builder/neutralino `latest*.yml` fields without pulling in a YAML dependency. */
export function parseUpdateManifest(yamlText: string): UpdateManifest | null {
  const top: Record<string, string> = {}
  const files: ParsedManifestEntry[] = []
  let inFiles = false
  let currentFile: ParsedManifestEntry | null = null

  for (const rawLine of yamlText.split(/\r?\n/)) {
    if (!rawLine.trim() || /^\s*#/.test(rawLine)) continue
    const indentMatch = rawLine.match(/^(\s*)(.*)$/)
    const indent = indentMatch ? indentMatch[1].length : 0
    const content = indentMatch ? indentMatch[2] : rawLine

    if (indent === 0 && !content.startsWith('-')) {
      inFiles = false
      currentFile = null
      const kv = content.match(/^([a-zA-Z0-9_]+)\s*:\s*(.*)$/)
      if (!kv) continue
      const [, key, rawVal] = kv
      if (key === 'files' && !rawVal.trim()) {
        inFiles = true
        continue
      }
      if (!(key in top) && rawVal.trim()) {
        top[key] = unquoteYamlScalar(rawVal)
      }
      continue
    }

    if (inFiles) {
      const listMatch = content.match(/^-\s*(.*)$/)
      if (listMatch) {
        currentFile = {}
        files.push(currentFile)
        const rest = listMatch[1].trim()
        if (!rest) continue
        const kv = rest.match(/^([a-zA-Z0-9_]+)\s*:\s*(.+)$/)
        if (kv) {
          assignManifestField(currentFile, kv[1], unquoteYamlScalar(kv[2]))
        }
        continue
      }
      if (currentFile) {
        const kv = content.match(/^([a-zA-Z0-9_]+)\s*:\s*(.+)$/)
        if (kv) {
          assignManifestField(currentFile, kv[1], unquoteYamlScalar(kv[2]))
        }
      }
    }
  }

  const version = top['version']?.trim()
  if (!version) {
    return null
  }

  let installerPath: string | undefined = (top['path'] || top['url'])?.trim()
  let sha512: string | undefined = top['sha512']?.trim()
  let size = top['size'] ? Number(top['size']) : undefined

  const matchingFile =
    files.find((f) => {
      const candidate = (f.path || f.url)?.trim()
      return candidate ? isFerryInstallerName(path.basename(candidate)) : false
    }) ?? files[0]

  if (installerPath && sha512) {
    if (!Number.isFinite(size) && matchingFile) {
      const candidate = (matchingFile.path || matchingFile.url)?.trim()
      if (candidate === installerPath && Number.isFinite(matchingFile.size)) {
        size = matchingFile.size
      }
    }
  } else if (matchingFile) {
    const entryPath = (matchingFile.path || matchingFile.url)?.trim()
    if (!installerPath) {
      installerPath = entryPath
      sha512 = matchingFile.sha512?.trim()
      if (!Number.isFinite(size)) size = matchingFile.size
    } else if (entryPath === installerPath) {
      sha512 = sha512 || matchingFile.sha512?.trim()
      if (!Number.isFinite(size)) size = matchingFile.size
    }
  }

  if (!installerPath || !sha512 || !isValidSha512Base64(sha512)) {
    return null
  }

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
  exitDelayMs?: number
}

export interface CheckForUpdatesResult {
  updateInfo: { version: string }
  downloadPromise?: Promise<string>
}

const DEFAULT_MANIFEST_TIMEOUT_MS = 15_000
const DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS = 30_000
const DEFAULT_EXIT_DELAY_MS = 1_500
const MAX_REDIRECTS = 5

type ExitShutdownHandler = (code: number) => Promise<void> | void
let registeredExitHandler: ExitShutdownHandler | null = null

/** Registers the runtime shutdown handler used by {@link SidecarUpdater.quitAndInstall} fallback exit. */
export function registerUpdaterExitHandler(handler: ExitShutdownHandler | null): void {
  registeredExitHandler = handler
}

async function computeFileSha512Base64(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash('sha512')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('base64')))
  })
}

async function waitForStreamDrain(stream: WriteStream, getError: () => Error | null): Promise<void> {
  const existing = getError()
  if (existing) throw existing
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      stream.removeListener('drain', onDrain)
      stream.removeListener('error', onErr)
      stream.removeListener('close', onClose)
    }
    const onDrain = (): void => {
      cleanup()
      resolve()
    }
    const onErr = (err: Error): void => {
      cleanup()
      reject(err)
    }
    const onClose = (): void => {
      cleanup()
      reject(getError() ?? new Error('Download file stream closed unexpectedly'))
    }
    stream.once('drain', onDrain)
    stream.once('error', onErr)
    stream.once('close', onClose)
  })
}

async function finishWriteStream(stream: WriteStream, getError: () => Error | null): Promise<void> {
  const existing = getError()
  if (existing) throw existing
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      stream.removeListener('finish', onFinish)
      stream.removeListener('error', onErr)
      stream.removeListener('close', onClose)
    }
    const onFinish = (): void => {
      cleanup()
      resolve()
    }
    const onErr = (err: Error): void => {
      cleanup()
      reject(err)
    }
    const onClose = (): void => {
      cleanup()
      const err = getError()
      if (err) reject(err)
      else resolve()
    }
    stream.once('finish', onFinish)
    stream.once('error', onErr)
    stream.once('close', onClose)
    stream.end()
  })
}

async function closeWriteStream(stream: WriteStream): Promise<void> {
  await new Promise<void>((resolve) => {
    if (stream.closed || stream.destroyed) {
      resolve()
      return
    }
    stream.once('close', () => resolve())
    stream.destroy()
  })
}

async function waitForChildSpawn(child: ChildProcess): Promise<void> {
  if (!child || typeof child.once !== 'function') {
    return
  }
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      child.removeListener('spawn', onSpawn)
      child.removeListener('error', onError)
    }
    const onSpawn = (): void => {
      cleanup()
      resolve()
    }
    const onError = (err: Error): void => {
      cleanup()
      reject(err)
    }
    child.once('spawn', onSpawn)
    child.once('error', onError)
  })
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
  private downloadedSha512: string | null = null
  private checkInFlight: Promise<CheckForUpdatesResult> | null = null
  private downloadInFlight: Promise<string> | null = null
  private pendingDownloadVersion: string | null = null
  private exitTimer: ReturnType<typeof setTimeout> | null = null
  private readonly deps: Required<SidecarUpdaterDeps>

  constructor(deps: SidecarUpdaterDeps = {}) {
    super()
    this.deps = {
      feedUrl: deps.feedUrl ?? (process.env['FERRY_UPDATE_FEED_URL'] || DEFAULT_UPDATE_FEED_URL),
      downloadDir: deps.downloadDir ?? path.join(os.tmpdir(), 'ferry-updater'),
      fetchImpl: deps.fetchImpl ?? fetch,
      spawnImpl: deps.spawnImpl ?? spawn,
      exitImpl:
        deps.exitImpl ??
        ((code) => {
          if (registeredExitHandler) {
            void registeredExitHandler(code)
            return
          }
          process.exit(code)
        }),
      manifestTimeoutMs: deps.manifestTimeoutMs ?? DEFAULT_MANIFEST_TIMEOUT_MS,
      downloadIdleTimeoutMs: deps.downloadIdleTimeoutMs ?? DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS,
      exitDelayMs: deps.exitDelayMs ?? DEFAULT_EXIT_DELAY_MS
    }
  }

  private assertAllowedUrl(parsed: URL, feedOrigin: string, kind: 'feed' | 'installer' | 'redirect'): void {
    const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
    const allowInsecureLocal = !host().isPackaged && isLoopback
    if (parsed.protocol !== 'https:' && !allowInsecureLocal) {
      const eventName =
        kind === 'feed'
          ? 'updater.insecure_feed_url'
          : kind === 'redirect'
            ? 'updater.insecure_redirect_url'
            : 'updater.insecure_installer_url'
      logSecurityEvent(eventName, { url: parsed.toString() })
      throw new Error(`Refusing insecure non-HTTPS update URL: ${parsed.toString()}`)
    }
    if (kind === 'feed') {
      return
    }
    if (parsed.origin !== feedOrigin && !TRUSTED_GITHUB_HOSTS.has(parsed.hostname)) {
      const eventName =
        kind === 'redirect' ? 'updater.untrusted_redirect_origin' : 'updater.untrusted_installer_origin'
      logSecurityEvent(eventName, { url: parsed.toString(), feedOrigin })
      const label = kind === 'redirect' ? 'update' : 'installer'
      throw new Error(`Refusing untrusted ${label} origin: ${parsed.origin}`)
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
    this.assertAllowedUrl(parsed, parsed.origin, 'feed')
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
    this.assertAllowedUrl(parsed, feedOrigin, 'installer')
    return parsed.toString()
  }

  private async fetchWithValidatedRedirects(
    initialUrl: string,
    signal: AbortSignal,
    feedOrigin: string,
    onBeforeHop?: () => void
  ): Promise<Response> {
    let currentUrl = initialUrl
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      onBeforeHop?.()
      const res = await this.deps.fetchImpl(currentUrl, { signal, redirect: 'manual' })
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        await res.body?.cancel().catch(() => undefined)
        if (!location) {
          throw new Error(`Update request received redirect (${res.status}) without Location header`)
        }
        if (hop === MAX_REDIRECTS) {
          throw new Error(`Too many redirects (${MAX_REDIRECTS}) while fetching update`)
        }
        let nextUrl: URL
        try {
          nextUrl = new URL(location, currentUrl)
        } catch {
          logSecurityEvent('updater.invalid_redirect_url', { from: currentUrl, location })
          throw new Error(`Invalid redirect URL in update response: ${location}`)
        }
        this.assertAllowedUrl(nextUrl, feedOrigin, 'redirect')
        currentUrl = nextUrl.toString()
        continue
      }
      return res
    }
    throw new Error(`Too many redirects (${MAX_REDIRECTS}) while fetching update`)
  }

  private async fetchManifest(): Promise<UpdateManifest> {
    const base = this.getFeedBase()
    const feedOrigin = new URL(base).origin
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(new Error(`Update manifest request timed out after ${this.deps.manifestTimeoutMs}ms`)),
      this.deps.manifestTimeoutMs
    )
    let manifestText: string
    try {
      const res = await this.fetchWithValidatedRedirects(
        `${base}/${UPDATE_MANIFEST_FILE}`,
        controller.signal,
        feedOrigin
      )
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
    this.resolveInstallerUrl(parsed.path, safeName)
    return parsed
  }

  private async downloadAndVerify(manifest: UpdateManifest): Promise<string> {
    const safeName = path.basename(manifest.path)
    if (!isFerryInstallerName(safeName)) {
      throw new Error(`Invalid installer filename in update manifest: ${manifest.path}`)
    }
    if (!isValidSha512Base64(manifest.sha512)) {
      throw new Error(`Invalid SHA-512 digest in update manifest for ${safeName}`)
    }
    mkdirSync(this.deps.downloadDir, { recursive: true })
    const finalPath = path.join(this.deps.downloadDir, safeName)
    const tmpPath = `${finalPath}.tmp`

    const feedOrigin = new URL(this.getFeedBase()).origin
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

    let res: Response
    try {
      res = await this.fetchWithValidatedRedirects(url, controller.signal, feedOrigin, armIdleTimer)
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
    let streamError: Error | null = null
    fileStream.on('error', (err) => {
      if (!streamError) {
        streamError = err
        controller.abort(err)
      }
    })

    let transferred = 0
    const startedAt = Date.now()
    const reader = res.body.getReader()

    try {
      while (true) {
        armIdleTimer()
        const { done, value } = await reader.read()
        if (done) break
        if (streamError) throw streamError
        const buf = Buffer.from(value)
        hash.update(buf)
        transferred += buf.length
        if (!fileStream.write(buf)) {
          await waitForStreamDrain(fileStream, () => streamError)
        }
        if (streamError) throw streamError
        const elapsedSec = Math.max(0.001, (Date.now() - startedAt) / 1000)
        this.emit('download-progress', {
          percent: total > 0 ? Math.min(100, (transferred / total) * 100) : 0,
          bytesPerSecond: Math.round(transferred / elapsedSec),
          transferred,
          total
        })
      }
      clearIdleTimer()
      await finishWriteStream(fileStream, () => streamError)
    } catch (err) {
      clearIdleTimer()
      if (!controller.signal.aborted) {
        controller.abort(err)
      }
      await reader.cancel().catch(() => undefined)
      await closeWriteStream(fileStream)
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

  clearDownloaded(): void {
    this.downloadedInstallerPath = null
    this.downloadedVersion = null
    this.downloadedSha512 = null
  }

  dispose(): void {
    if (this.exitTimer !== null) {
      clearTimeout(this.exitTimer)
      this.exitTimer = null
    }
    this.clearDownloaded()
  }

  async checkForUpdates(): Promise<CheckForUpdatesResult> {
    if (this.checkInFlight) {
      return this.checkInFlight
    }
    if (this.downloadInFlight) {
      const currentVersion = host().appVersion ?? FALLBACK_APP_VERSION
      return {
        updateInfo: { version: this.pendingDownloadVersion ?? currentVersion },
        downloadPromise: this.downloadInFlight
      }
    }

    const run = (async (): Promise<CheckForUpdatesResult> => {
      this.emit('checking-for-update')
      const manifest = await this.fetchManifest()
      const currentVersion = host().appVersion ?? FALLBACK_APP_VERSION
      if (compareSemver(manifest.version, currentVersion) <= 0) {
        this.clearDownloaded()
        this.emit('update-not-available', { version: currentVersion })
        return { updateInfo: { version: currentVersion } }
      }

      this.clearDownloaded()
      this.emit('update-available', { version: manifest.version })
      if (!this.autoDownload) {
        return { updateInfo: { version: manifest.version } }
      }

      this.pendingDownloadVersion = manifest.version
      const downloadPromise = this.downloadAndVerify(manifest)
        .then((installerPath) => {
          this.downloadedInstallerPath = installerPath
          this.downloadedVersion = manifest.version
          this.downloadedSha512 = manifest.sha512
          this.emit('update-downloaded', { version: manifest.version })
          return installerPath
        })
        .catch((err) => {
          this.clearDownloaded()
          const error = err instanceof Error ? err : new Error(String(err))
          this.emit('error', error)
          throw error
        })
        .finally(() => {
          if (this.downloadInFlight === downloadPromise) {
            this.downloadInFlight = null
            this.pendingDownloadVersion = null
          }
        })
      // Prevent Node unhandledRejection when callers observe outcome via events.
      void downloadPromise.catch(() => undefined)
      this.downloadInFlight = downloadPromise
      return { updateInfo: { version: manifest.version }, downloadPromise }
    })().finally(() => {
      if (this.checkInFlight === run) {
        this.checkInFlight = null
      }
    })

    this.checkInFlight = run
    return run
  }

  async quitAndInstall(isSilent = true, isForceRunAfter = true): Promise<void> {
    if (this.exitTimer !== null) {
      return
    }
    const installerPath = this.downloadedInstallerPath
    const expectedSha512 = this.downloadedSha512
    if (!installerPath || !expectedSha512 || !existsSync(installerPath)) {
      this.clearDownloaded()
      throw new Error('No verified update installer is ready to launch')
    }

    let actualSha512: string
    try {
      actualSha512 = await computeFileSha512Base64(installerPath)
    } catch (err) {
      this.clearDownloaded()
      throw new Error(
        `Unable to verify update installer before launch: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    if (actualSha512 !== expectedSha512) {
      this.clearDownloaded()
      logSecurityEvent('updater.pre_exec_sha512_mismatch', {
        file: path.basename(installerPath),
        expected: expectedSha512,
        actual: actualSha512
      })
      throw new Error(`SHA-512 verification failed before launching ${path.basename(installerPath)}`)
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
    await waitForChildSpawn(child)
    child.unref()

    this.exitTimer = setTimeout(() => {
      this.exitTimer = null
      this.deps.exitImpl(0)
    }, this.deps.exitDelayMs)
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

export function resetSidecarUpdaterForTests(): void {
  singleton?.dispose()
  singleton = null
}
