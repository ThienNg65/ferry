import { randomUUID } from 'crypto'
import { createWriteStream, promises as fs, type WriteStream } from 'fs'
import * as path from 'path'
import * as os from 'os'
import { SshError } from '../ssh/errors'
import { logSecurityEvent } from '../host/securityLog'
import type {
  FileEntry,
  FileListResult,
  FileReadResult,
  IpcErrorCode,
  StageDropBeginRequest,
  StageDropBeginResult,
  StageDropRequest
} from '../../shared/contract'

function isRootOrEmpty(p: string): boolean {
  const trimmed = (p ?? '').trim()
  if (!trimmed) {
    return true
  }
  const normalized = trimmed.replace(/\\/g, '/')
  if (normalized === '/' || /^[a-zA-Z]:\/?$/.test(normalized)) {
    return true
  }
  const resolved = path.resolve(trimmed)
  return resolved === path.parse(resolved).root
}

/** Cap on how much of a file is read for preview — huge logs are truncated, not rejected. */
const MAX_TEXT_PREVIEW_BYTES = 1_048_576

/** Lists a local directory. Falls back to the OS home directory when no path is given. */
export async function list(dirPath?: string): Promise<FileListResult> {
  const resolved = dirPath && dirPath.length > 0 ? path.resolve(dirPath) : os.homedir()
  let dirents
  try {
    dirents = await fs.readdir(resolved, { withFileTypes: true })
  } catch (e) {
    throw new SshError('NOT_FOUND', `Cannot list "${resolved}": ${(e as Error).message}`)
  }

  const statted = await Promise.all(
    dirents.map(async (dirent): Promise<FileEntry | null> => {
      const fullPath = path.join(resolved, dirent.name)
      const isSymlink = dirent.isSymbolicLink()

      if (!isSymlink) {
        try {
          const stats = await fs.stat(fullPath)
          return {
            name: dirent.name,
            path: fullPath,
            isDir: dirent.isDirectory(),
            size: stats.size,
            modifiedAt: stats.mtime.toISOString(),
            isSymlink: false
          }
        } catch {
          // Entry vanished mid-listing (rare race, not user-relevant) — skip it.
          return null
        }
      }

      // Symlink: follow it for isDir/size/modifiedAt (fs.stat follows links), but
      // never hide a broken/circular link — show it with a broken indicator instead.
      const symlinkTarget = await fs.readlink(fullPath).catch(() => undefined)
      try {
        const stats = await fs.stat(fullPath)
        return {
          name: dirent.name,
          path: fullPath,
          isDir: stats.isDirectory(),
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
          isSymlink: true,
          symlinkTarget
        }
      } catch {
        const lstat = await fs.lstat(fullPath).catch(() => null)
        return {
          name: dirent.name,
          path: fullPath,
          isDir: false,
          size: 0,
          modifiedAt: lstat ? lstat.mtime.toISOString() : null,
          isSymlink: true,
          symlinkTarget,
          symlinkBroken: true
        }
      }
    })
  )
  const entries: FileEntry[] = statted.filter((e): e is FileEntry => e !== null)
  return { path: resolved, entries }
}

/** Creates a local directory. */
export async function mkdir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath)
  } catch (e) {
    throw new SshError('UNKNOWN', `Cannot create "${dirPath}": ${(e as Error).message}`)
  }
}

/** Creates an empty local file, failing if it already exists. */
export async function touch(filePath: string): Promise<void> {
  try {
    await fs.writeFile(filePath, '', { flag: 'wx' })
  } catch (e) {
    throw new SshError('UNKNOWN', `Cannot create "${filePath}": ${(e as Error).message}`)
  }
}

/** Renames/moves a local path. */
export async function rename(fromPath: string, toPath: string): Promise<void> {
  try {
    await fs.rename(fromPath, toPath)
  } catch (e) {
    throw new SshError('UNKNOWN', `Cannot rename "${fromPath}": ${(e as Error).message}`)
  }
}

/** Reads a local file's content as text, capped at MAX_TEXT_PREVIEW_BYTES. */
export async function readFileText(filePath: string): Promise<FileReadResult> {
  const stats = await fs.stat(filePath)
  const length = Math.min(stats.size, MAX_TEXT_PREVIEW_BYTES)
  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return {
      path: filePath,
      content: buffer.subarray(0, bytesRead).toString('utf-8'),
      truncated: stats.size > MAX_TEXT_PREVIEW_BYTES,
      size: stats.size
    }
  } finally {
    await handle.close()
  }
}

/** Writes full text content to a local file, replacing it entirely. */
export async function writeFileText(filePath: string, content: string): Promise<void> {
  try {
    await fs.writeFile(filePath, content, 'utf-8')
  } catch (e) {
    throw new SshError('UNKNOWN', `Cannot write to "${filePath}": ${(e as Error).message}`)
  }
}

/** Deletes a local file or directory (recursively for directories). */
export async function remove(targetPath: string, isDir: boolean): Promise<void> {
  if (isRootOrEmpty(targetPath)) {
    throw new SshError(
      'INVALID_TARGET' as unknown as IpcErrorCode,
      `Refusing to delete root or empty path "${targetPath}"`
    )
  }
  try {
    if (isDir) {
      await fs.rm(targetPath, { recursive: true })
    } else {
      await fs.unlink(targetPath)
    }
  } catch (e) {
    throw new SshError('UNKNOWN', `Cannot delete "${targetPath}": ${(e as Error).message}`)
  }
}

/** One entry in a recursively-walked directory tree, path relative (`/`-separated) to the walk root. */
export interface TreeEntry {
  relPath: string
  isDir: boolean
  size: number
  /** Epoch ms — absent for directory entries (only files need it, for sync's change-detection diff). */
  mtimeMs?: number
}

/** Recursively walks a local directory, depth-first, parent directories before their children. */
export async function listRecursive(dirPath: string): Promise<TreeEntry[]> {
  const results: TreeEntry[] = []

  async function walk(currentPath: string, relBase: string): Promise<void> {
    const dirents = await fs.readdir(currentPath, { withFileTypes: true })
    for (const dirent of dirents) {
      const relPath = relBase ? `${relBase}/${dirent.name}` : dirent.name
      const fullPath = path.join(currentPath, dirent.name)
      if (dirent.isDirectory()) {
        results.push({ relPath, isDir: true, size: 0 })
        await walk(fullPath, relPath)
      } else if (dirent.isFile()) {
        const stats = await fs.stat(fullPath)
        results.push({ relPath, isDir: false, size: stats.size, mtimeMs: stats.mtimeMs })
      }
    }
  }

  try {
    await walk(dirPath, '')
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'NOT_FOUND' : 'UNKNOWN'
    throw new SshError(code, `Cannot list "${dirPath}": ${(e as Error).message}`)
  }
  return results
}

/** Creates a local directory and any missing parent directories (no error if it already exists). */
export async function mkdirRecursive(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true })
  } catch (e) {
    throw new SshError('UNKNOWN', `Cannot create "${dirPath}": ${(e as Error).message}`)
  }
}

export const MAX_STAGE_DROP_BYTES = 16 * 1024 * 1024
export const MAX_STAGE_DROP_ENTRIES = 1000
const STAGE_DROP_PREFIX = 'ferry-drop-'
const STAGE_SESSION_TTL_MS = 30 * 60 * 1000
const STAGE_WRITE_HIGH_WATER_MARK = 256 * 1024
const activeStageDirs = new Set<string>()

interface StageDropSession {
  root: string
  createdAt: number
  topLevelOrder: string[]
  topLevelMeta: Map<string, { modifiedAt?: string }>
  writtenPaths: Set<string>
  streams: Set<WriteStream>
}

const activeStageSessions = new Map<string, StageDropSession>()

function normalizeStageSegments(relativePath: string): string[] {
  const rawRel = String(relativePath ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!rawRel || /^[a-zA-Z]:/.test(rawRel)) {
    logSecurityEvent('fs.stage_drop_path_blocked', { relativePath })
    throw new SshError('VALIDATION', `Invalid dropped relative path "${relativePath}"`)
  }
  const segments = rawRel.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((s) => s === '.' || s === '..')) {
    logSecurityEvent('fs.stage_drop_path_blocked', { relativePath })
    throw new SshError('VALIDATION', `Unsafe dropped relative path "${relativePath}"`)
  }
  return segments
}

function resolveStageTarget(stageRoot: string, segments: string[]): string {
  const targetPath = path.resolve(stageRoot, ...segments)
  if (!targetPath.startsWith(stageRoot + path.sep)) {
    throw new SshError('VALIDATION', `Escaped staging root for "${segments.join('/')}"`)
  }
  return targetPath
}

function recordStageTopLevel(
  topLevelOrder: string[],
  topLevelMeta: Map<string, { modifiedAt?: string }>,
  segments: string[],
  modifiedAt?: string
): void {
  const topName = segments[0]
  if (!topLevelMeta.has(topName)) {
    topLevelOrder.push(topName)
    topLevelMeta.set(topName, {
      modifiedAt: segments.length === 1 && isValidIsoDate(modifiedAt) ? modifiedAt : undefined
    })
  }
}

function isValidIsoDate(value?: string): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value))
}

async function buildStageFileEntries(
  stageRoot: string,
  topLevelOrder: string[],
  topLevelMeta: Map<string, { modifiedAt?: string }>
): Promise<FileEntry[]> {
  const out: FileEntry[] = []
  for (const name of topLevelOrder) {
    const fullPath = path.join(stageRoot, name)
    const stats = await fs.stat(fullPath)
    out.push({
      name,
      path: fullPath,
      isDir: stats.isDirectory(),
      size: stats.isDirectory() ? 0 : stats.size,
      modifiedAt: topLevelMeta.get(name)?.modifiedAt ?? stats.mtime.toISOString(),
      isSymlink: false
    })
  }
  return out
}

async function sweepExpiredStageSessions(): Promise<void> {
  const cutoff = Date.now() - STAGE_SESSION_TTL_MS
  const expiredRoots: string[] = []
  for (const [id, session] of activeStageSessions) {
    if (session.createdAt <= cutoff) {
      activeStageSessions.delete(id)
      activeStageDirs.delete(session.root)
      expiredRoots.push(session.root)
    }
  }
  await Promise.all(expiredRoots.map((root) => fs.rm(root, { recursive: true, force: true }).catch(() => undefined)))
}

function isStagedDropDir(dirPath: string): boolean {
  const resolvedTmp = path.resolve(os.tmpdir())
  const resolvedDir = path.resolve(dirPath)
  const parent = path.dirname(resolvedDir)
  return parent === resolvedTmp && path.basename(resolvedDir).startsWith(STAGE_DROP_PREFIX)
}

function findStagedRoot(targetPath: string): string | null {
  const resolvedTarget = path.resolve(targetPath)
  for (const dir of activeStageDirs) {
    if (resolvedTarget === dir || resolvedTarget.startsWith(dir + path.sep)) {
      return dir
    }
  }
  const relToTmp = path.relative(os.tmpdir(), resolvedTarget)
  if (relToTmp && !relToTmp.startsWith('..') && !path.isAbsolute(relToTmp)) {
    const firstSeg = relToTmp.split(path.sep)[0]
    if (firstSeg?.startsWith(STAGE_DROP_PREFIX)) {
      return path.join(os.tmpdir(), firstSeg)
    }
  }
  return null
}

/** Removes a staged drop item after upload/cancel, pruning empty parent directories up to `ferry-drop-*`. */
export async function cleanupStagedDropPath(localPath: string): Promise<void> {
  const stageRoot = findStagedRoot(localPath)
  if (!stageRoot || !isStagedDropDir(stageRoot)) {
    return
  }
  const resolvedTarget = path.resolve(localPath)
  await fs.rm(resolvedTarget, { recursive: true, force: true })
  let current = resolvedTarget === stageRoot ? stageRoot : path.dirname(resolvedTarget)
  while (current.startsWith(stageRoot)) {
    const remaining = await fs.readdir(current).catch(() => null)
    if (!remaining || remaining.length > 0) {
      break
    }
    await fs.rm(current, { recursive: true, force: true }).catch(() => undefined)
    if (current === stageRoot) {
      activeStageDirs.delete(stageRoot)
      break
    }
    current = path.dirname(current)
  }
}

/** Cleans staged drop paths for a batch of skipped or cancelled upload intents. */
export async function cleanupStagedDropPaths(paths: string[]): Promise<void> {
  await Promise.all(paths.map((p) => cleanupStagedDropPath(p).catch(() => undefined)))
}

/** Cleans tracked staged drop directories and sweeps stale `ferry-drop-*` folders from `os.tmpdir()`. */
export async function cleanupAllStagedDrops(maxAgeMs = 3_600_000): Promise<void> {
  activeStageSessions.clear()
  const tracked = [...activeStageDirs]
  activeStageDirs.clear()
  await Promise.all(tracked.map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)))

  const cutoff = maxAgeMs <= 0 ? Number.POSITIVE_INFINITY : Date.now() - maxAgeMs
  const tmpDir = os.tmpdir()
  const entries = await fs.readdir(tmpDir, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    entries
      .filter((e) => e.isDirectory() && e.name.startsWith(STAGE_DROP_PREFIX))
      .map(async (e) => {
        const full = path.join(tmpDir, e.name)
        const stats = await fs.stat(full).catch(() => null)
        if (!stats || stats.mtimeMs <= cutoff) {
          await fs.rm(full, { recursive: true, force: true }).catch(() => undefined)
        }
      })
  )
}

/**
 * Starts a streaming external-drop staging session in a validated `ferry-drop-*` temp directory,
 * optionally pre-creating empty/nested directory structure before files stream over localhost HTTP.
 */
export async function beginStageDrop(req?: StageDropBeginRequest): Promise<StageDropBeginResult> {
  await sweepExpiredStageSessions()
  const dirs = Array.isArray(req?.dirs) ? req.dirs : []
  const validatedDirs = dirs.map((d) => normalizeStageSegments(d))
  const stageRoot = await fs.mkdtemp(path.join(os.tmpdir(), STAGE_DROP_PREFIX))
  const stageId = randomUUID()
  const session: StageDropSession = {
    root: stageRoot,
    createdAt: Date.now(),
    topLevelOrder: [],
    topLevelMeta: new Map(),
    writtenPaths: new Set(),
    streams: new Set()
  }
  activeStageDirs.add(stageRoot)
  activeStageSessions.set(stageId, session)

  try {
    for (const segments of validatedDirs) {
      const targetPath = resolveStageTarget(stageRoot, segments)
      recordStageTopLevel(session.topLevelOrder, session.topLevelMeta, segments)
      await fs.mkdir(targetPath, { recursive: true })
    }
  } catch (err) {
    activeStageSessions.delete(stageId)
    activeStageDirs.delete(stageRoot)
    await fs.rm(stageRoot, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }
  return { stageId }
}

/** Opens a validated local write stream for one file inside an active staging session. */
export async function openStageDropWriteStream(
  stageId: string,
  relativePath: string,
  modifiedAt?: string
): Promise<{ stream: WriteStream; targetPath: string }> {
  const session = activeStageSessions.get(stageId)
  if (!session) {
    throw new SshError('NOT_FOUND', `Staging session "${stageId}" not found or expired`)
  }
  const segments = normalizeStageSegments(relativePath)
  const dedupeKey = (process.platform === 'win32' ? segments.join('/').toLowerCase() : segments.join('/'))
  if (session.writtenPaths.has(dedupeKey)) {
    throw new SshError('VALIDATION', `Duplicate staged relative path "${relativePath}"`)
  }
  session.writtenPaths.add(dedupeKey)
  const targetPath = resolveStageTarget(session.root, segments)
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  recordStageTopLevel(session.topLevelOrder, session.topLevelMeta, segments, modifiedAt)
  const stream = createWriteStream(targetPath, { highWaterMark: STAGE_WRITE_HIGH_WATER_MARK })
  session.streams.add(stream)
  stream.once('close', () => session.streams.delete(stream))
  return {
    stream,
    targetPath
  }
}

/** Finalizes an active staging session and returns top-level `FileEntry` records. */
export async function finishStageDrop(stageId: string): Promise<FileEntry[]> {
  const session = activeStageSessions.get(stageId)
  if (!session) {
    throw new SshError('NOT_FOUND', `Staging session "${stageId}" not found or expired`)
  }
  activeStageSessions.delete(stageId)
  try {
    return await buildStageFileEntries(session.root, session.topLevelOrder, session.topLevelMeta)
  } catch (err) {
    activeStageDirs.delete(session.root)
    await fs.rm(session.root, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }
}

/** Cancels an active staging session and removes its temporary directory immediately. */
export async function abortStageDrop(stageId: string): Promise<void> {
  const session = activeStageSessions.get(stageId)
  if (!session) {
    return
  }
  activeStageSessions.delete(stageId)
  activeStageDirs.delete(session.root)
  await Promise.all(
    [...session.streams].map(
      (stream) =>
        new Promise<void>((resolve) => {
          if (stream.closed || stream.destroyed) {
            resolve()
            return
          }
          stream.on('error', () => {})
          stream.once('close', () => resolve())
          stream.destroy()
        })
    )
  )
  await fs.rm(session.root, { recursive: true, force: true }).catch(() => undefined)
}

/**
 * Stages small external drops sent inline over RPC (used as fallback when direct
 * localhost HTTP streaming is unavailable, and in unit tests).
 */
export async function stageDroppedEntries(req: StageDropRequest): Promise<FileEntry[]> {
  const entries = Array.isArray(req?.entries) ? req.entries : []
  if (entries.length === 0) {
    return []
  }
  if (entries.length > MAX_STAGE_DROP_ENTRIES) {
    logSecurityEvent('fs.stage_drop_entry_limit', { count: entries.length, max: MAX_STAGE_DROP_ENTRIES })
    throw new SshError(
      'VALIDATION',
      `Dropped selection exceeds the ${MAX_STAGE_DROP_ENTRIES}-item staging limit. Use the Local pane for larger transfers.`
    )
  }

  let totalBytes = 0
  const normalized: Array<{ segments: string[]; isDir: boolean; data?: Uint8Array; modifiedAt?: string }> = []
  for (const item of entries) {
    const segments = normalizeStageSegments(item.relativePath)
    const bytes = item.data ? Buffer.from(item.data) : Buffer.alloc(0)
    totalBytes += bytes.length
    if (totalBytes > MAX_STAGE_DROP_BYTES) {
      throw new SshError(
        'VALIDATION',
        'Dropped files exceed the 16 MB in-memory staging limit. Use the Local pane for larger transfers.'
      )
    }
    normalized.push({
      segments,
      isDir: Boolean(item.isDir),
      data: item.isDir ? undefined : bytes,
      modifiedAt: item.modifiedAt
    })
  }

  const stageRoot = await fs.mkdtemp(path.join(os.tmpdir(), STAGE_DROP_PREFIX))
  activeStageDirs.add(stageRoot)
  const topLevelOrder: string[] = []
  const topLevelMeta = new Map<string, { modifiedAt?: string }>()

  try {
    for (const item of normalized) {
      const targetPath = resolveStageTarget(stageRoot, item.segments)
      recordStageTopLevel(topLevelOrder, topLevelMeta, item.segments, item.modifiedAt)
      if (item.isDir) {
        await fs.mkdir(targetPath, { recursive: true })
      } else {
        await fs.mkdir(path.dirname(targetPath), { recursive: true })
        await fs.writeFile(targetPath, item.data ?? Buffer.alloc(0))
      }
    }
    return await buildStageFileEntries(stageRoot, topLevelOrder, topLevelMeta)
  } catch (err) {
    activeStageDirs.delete(stageRoot)
    await fs.rm(stageRoot, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }
}
