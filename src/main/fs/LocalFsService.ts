import { randomUUID } from 'crypto'
import { createWriteStream, promises as fs, type WriteStream } from 'fs'
import * as path from 'path'
import * as os from 'os'
import { SshError } from '../ssh/errors'
import { logSecurityEvent } from '../host/securityLog'
import { MAX_STAGE_DROP_DEPTH, MAX_STAGE_DROP_ENTRIES } from '../../shared/contract'
import { pickUniqueName } from '../../shared/uniqueName'
import type {
  CopyManyResult,
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
    const code = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'NOT_FOUND' : 'UNKNOWN'
    throw new SshError(code, `Cannot list "${resolved}": ${(e as Error).message}`)
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
export async function rename(fromPath: string, toPath: string, replace?: boolean): Promise<void> {
  try {
    if (replace === false) {
      const destination = await fs.lstat(toPath).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e
        return null
      })
      if (destination) {
        const caseOnly = process.platform === 'win32' && fromPath !== toPath
          && fromPath.toLowerCase() === toPath.toLowerCase()
        const otherEntry = !caseOnly || (await fs.readdir(path.dirname(toPath))).some((name) =>
          name.toLowerCase() === path.basename(toPath).toLowerCase() && name !== path.basename(fromPath)
        )
        if (otherEntry) throw new SshError('ALREADY_EXISTS', `"${toPath}" already exists.`)
      }
    }
    await fs.rename(fromPath, toPath)
  } catch (e) {
    if (e instanceof SshError) throw e
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

/** Copies local files/folders recursively into `targetDir` with non-destructive collision naming. */
export async function copyLocal(
  sourcePaths: string[],
  targetDir: string,
  options?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }
): Promise<CopyManyResult> {
  if (!targetDir || !targetDir.trim()) {
    throw new SshError('VALIDATION', 'Target directory is required')
  }
  const resolvedTargetDir = path.resolve(targetDir)
  let targetStat
  try {
    targetStat = await fs.stat(resolvedTargetDir)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'NOT_FOUND' : 'UNKNOWN'
    throw new SshError(code, `Target directory "${resolvedTargetDir}" is not accessible: ${(e as Error).message}`)
  }
  if (!targetStat.isDirectory()) {
    throw new SshError('VALIDATION', `Target "${resolvedTargetDir}" is not a directory`)
  }

  const isWin = process.platform === 'win32'
  const existingNames = await fs.readdir(resolvedTargetDir)
  const taken = new Set(existingNames.map((n) => (isWin ? n.toLowerCase() : n)))

  const result: CopyManyResult = { copied: [], failures: [] }
  let done = 0
  for (const rawSource of sourcePaths) {
    if (options?.signal?.aborted) {
      throw new SshError('CANCELLED', 'Copy cancelled')
    }
    try {
      if (isRootOrEmpty(rawSource)) {
        throw new SshError('VALIDATION', `Refusing to copy root or empty path "${rawSource}"`)
      }
      const src = path.resolve(rawSource)
      const stats = await fs.lstat(src)
      const isDir = stats.isDirectory()
      if (isDir) {
        const rel = path.relative(src, resolvedTargetDir)
        if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
          throw new SshError('VALIDATION', 'Cannot copy a folder into itself or one of its subdirectories.')
        }
      }
      const baseName = path.basename(src)
      let destName = pickUniqueName(baseName, isDir, taken, isWin)
      let destPath = path.join(resolvedTargetDir, destName)
      while (await fs.lstat(destPath).then(() => true, () => false)) {
        destName = pickUniqueName(baseName, isDir, taken, isWin)
        destPath = path.join(resolvedTargetDir, destName)
      }
      await fs.cp(src, destPath, {
        recursive: true,
        force: false,
        errorOnExist: true,
        preserveTimestamps: true,
        verbatimSymlinks: true
      })
      result.copied.push({ sourcePath: src, targetPath: destPath })
    } catch (e) {
      if (e instanceof SshError && e.code === 'CANCELLED') {
        throw e
      }
      result.failures.push({ path: rawSource, error: e instanceof Error ? e.message : String(e) })
    }
    done += 1
    options?.onProgress?.(done, sourcePaths.length)
  }
  return result
}

/** One entry in a recursively-walked directory tree, path relative (`/`-separated) to the walk root. */
export interface TreeEntry {
  relPath: string
  isDir: boolean
  isSymlink?: true
  size: number
  /** Epoch ms — absent for directory entries (only files need it, for sync's change-detection diff). */
  mtimeMs?: number
}

/** Walks parents before children. When requested, includes symlinks as leaves. */
export async function listRecursive(dirPath: string, includeSymlinks = false): Promise<TreeEntry[]> {
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
      } else if (includeSymlinks && dirent.isSymbolicLink()) {
        results.push({ relPath, isDir: false, isSymlink: true, size: 0 })
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
export { MAX_STAGE_DROP_DEPTH, MAX_STAGE_DROP_ENTRIES }
const STAGE_DROP_PREFIX = 'ferry-drop-'
const STAGE_DROP_MARKER = '.ferry-stage-owner'
const STAGE_DROP_MARKER_CONTENT = 'ferry-stage-drop:v1\n'
const STAGE_SESSION_TTL_MS = 30 * 60 * 1000
const STAGE_WRITE_HIGH_WATER_MARK = 256 * 1024
const activeStageDirs = new Set<string>()

interface StageDropSession {
  root: string
  createdAt: number
  lastActivityAt: number
  pendingOpens: number
  pendingOpenWaiters: Set<() => void>
  topLevelOrder: string[]
  topLevelMeta: Map<string, { modifiedAt?: string }>
  writtenPaths: Set<string>
  stagedPaths: Set<string>
  streams: Set<WriteStream>
}

const activeStageSessions = new Map<string, StageDropSession>()

function normalizeStageSegments(relativePath: string, isDir = false): string[] {
  const rawRel = String(relativePath ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!rawRel || /^[a-zA-Z]:/.test(rawRel)) {
    logSecurityEvent('fs.stage_drop_path_blocked', { relativePath })
    throw new SshError('VALIDATION', `Invalid dropped relative path "${relativePath}"`)
  }
  const segments = rawRel.split('/').filter(Boolean)
  const reservedMarker = segments[0]?.toLowerCase() === STAGE_DROP_MARKER.toLowerCase()
  if (reservedMarker) {
    logSecurityEvent('fs.stage_drop_path_blocked', { relativePath })
    throw new SshError('VALIDATION', 'The staging ownership marker path is reserved')
  }
  if (segments.length === 0 || segments.some((s) => s === '.' || s === '..')) {
    logSecurityEvent('fs.stage_drop_path_blocked', { relativePath })
    throw new SshError('VALIDATION', `Unsafe dropped relative path "${relativePath}"`)
  }
  const directoryDepth = isDir ? segments.length : segments.length - 1
  if (directoryDepth > MAX_STAGE_DROP_DEPTH) {
    logSecurityEvent('fs.stage_drop_depth_limit', { depth: directoryDepth, max: MAX_STAGE_DROP_DEPTH })
    throw new SshError(
      'VALIDATION',
      `Dropped folder nesting exceeds the ${MAX_STAGE_DROP_DEPTH}-level staging limit. Use the Local pane for larger transfers.`
    )
  }
  return segments
}

function stagePathKey(segments: string[]): string {
  const key = segments.join('/')
  return process.platform === 'win32' ? key.toLowerCase() : key
}

/** Reserves each unique directory and file path, including parent directories implied by files. */
function reserveStagePaths(stagedPaths: Set<string>, segments: string[], isDir: boolean): void {
  const directoryDepth = isDir ? segments.length : segments.length - 1
  const keys: string[] = []
  for (let depth = 1; depth <= directoryDepth; depth++) {
    keys.push(stagePathKey(segments.slice(0, depth)))
  }
  keys.push(stagePathKey(segments))

  const additions = [...new Set(keys)].filter((key) => !stagedPaths.has(key))
  const nextCount = stagedPaths.size + additions.length
  if (nextCount > MAX_STAGE_DROP_ENTRIES) {
    logSecurityEvent('fs.stage_drop_entry_limit', { count: nextCount, max: MAX_STAGE_DROP_ENTRIES })
    throw new SshError(
      'VALIDATION',
      `Dropped selection exceeds the ${MAX_STAGE_DROP_ENTRIES}-item staging limit. Use the Local pane for larger transfers.`
    )
  }
  for (const key of additions) {
    stagedPaths.add(key)
  }
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

async function createStageDropOwnershipMarker(stageRoot: string): Promise<void> {
  await fs.writeFile(path.join(stageRoot, STAGE_DROP_MARKER), STAGE_DROP_MARKER_CONTENT, {
    flag: 'wx',
    mode: 0o600
  })
}

function isStageDropRootPath(dirPath: string): boolean {
  const resolvedDir = path.resolve(dirPath)
  return path.dirname(resolvedDir) === path.resolve(os.tmpdir())
    && path.basename(resolvedDir).startsWith(STAGE_DROP_PREFIX)
}

/** Marker read failures, symlinks, and malformed markers are treated as not owned. */
async function isOwnedStageRoot(dirPath: string): Promise<boolean> {
  if (!isStageDropRootPath(dirPath)) {
    return false
  }

  const resolvedDir = path.resolve(dirPath)
  try {
    const rootStats = await fs.lstat(resolvedDir)
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      return false
    }

    const markerPath = path.join(resolvedDir, STAGE_DROP_MARKER)
    const markerStats = await fs.lstat(markerPath)
    if (!markerStats.isFile() || markerStats.isSymbolicLink()) {
      return false
    }

    return (await fs.readFile(markerPath, 'utf8')) === STAGE_DROP_MARKER_CONTENT
  } catch {
    return false
  }
}

async function removeOwnedStageRoot(stageRoot: string): Promise<boolean> {
  const resolvedRoot = path.resolve(stageRoot)
  if (!(await isOwnedStageRoot(resolvedRoot))) {
    return false
  }
  await fs.rm(resolvedRoot, { recursive: true, force: true })
  activeStageDirs.delete(resolvedRoot)
  return true
}

function isPathWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

/** Reject symlinked parent components so cleanup cannot traverse outside the owned root. */
async function hasSafeStagePathParents(stageRoot: string, targetPath: string): Promise<boolean> {
  const relative = path.relative(stageRoot, targetPath)
  if (!isPathWithin(stageRoot, targetPath)) {
    return false
  }

  let current = stageRoot
  const segments = relative.split(path.sep)
  for (const segment of segments.slice(0, -1)) {
    if (!segment) continue
    current = path.join(current, segment)
    const stats = await fs.lstat(current).catch(() => null)
    if (!stats?.isDirectory() || stats.isSymbolicLink()) {
      return false
    }
  }
  return true
}

async function closeStageDropStreams(session: StageDropSession): Promise<void> {
  await Promise.all(
    [...session.streams].map(
      (stream) =>
        new Promise<void>((resolve) => {
          if (stream.closed) {
            session.streams.delete(stream)
            resolve()
            return
          }

          const ignoreError = () => {}
          stream.on('error', ignoreError)
          stream.once('close', () => {
            stream.off('error', ignoreError)
            session.streams.delete(stream)
            resolve()
          })
          if (!stream.destroyed) {
            stream.destroy()
          }
        })
    )
  )
}

async function waitForPendingStageOpens(session: StageDropSession): Promise<void> {
  if (session.pendingOpens === 0) {
    return
  }
  await new Promise<void>((resolve) => session.pendingOpenWaiters.add(resolve))
}

function finishPendingStageOpen(session: StageDropSession): void {
  session.pendingOpens -= 1
  if (session.pendingOpens === 0) {
    for (const resolve of session.pendingOpenWaiters) {
      resolve()
    }
    session.pendingOpenWaiters.clear()
  }
  session.lastActivityAt = Date.now()
}

async function sweepExpiredStageSessions(): Promise<void> {
  const cutoff = Date.now() - STAGE_SESSION_TTL_MS
  const expiredSessions: StageDropSession[] = []
  for (const [id, session] of activeStageSessions) {
    // A stalled open stream is inactive too; close it when the inactivity TTL elapses.
    // Keep a session alive while a stream still has buffered or in-flight data.
    const hasPendingWrites = [...session.streams].some(
      (stream) => stream.writableLength > 0 || stream.writableNeedDrain
    )
    if (session.pendingOpens === 0 && !hasPendingWrites && session.lastActivityAt <= cutoff) {
      activeStageSessions.delete(id)
      expiredSessions.push(session)
    }
  }

  await Promise.all(
    expiredSessions.map(async (session) => {
      await closeStageDropStreams(session)
      await removeOwnedStageRoot(session.root).catch(() => false)
    })
  )
}

async function findStagedRoot(targetPath: string): Promise<string | null> {
  const resolvedTarget = path.resolve(targetPath)
  for (const dir of activeStageDirs) {
    const resolvedDir = path.resolve(dir)
    if (isPathWithin(resolvedDir, resolvedTarget)) {
      return await isOwnedStageRoot(resolvedDir) ? resolvedDir : null
    }
  }

  const tmpDir = path.resolve(os.tmpdir())
  const relative = path.relative(tmpDir, resolvedTarget)
  if (!relative || !isPathWithin(tmpDir, resolvedTarget)) {
    return null
  }

  const firstSegment = relative.split(path.sep)[0]
  if (!firstSegment?.startsWith(STAGE_DROP_PREFIX)) {
    return null
  }

  const candidate = path.join(tmpDir, firstSegment)
  return await isOwnedStageRoot(candidate) ? candidate : null
}

/** Removes an owned staged item after upload/cancel, pruning empty parents without following symlinks. */
export async function cleanupStagedDropPath(localPath: string): Promise<void> {
  const stageRoot = await findStagedRoot(localPath)
  if (!stageRoot) {
    return
  }

  const resolvedTarget = path.resolve(localPath)
  if (
    path.dirname(resolvedTarget) === stageRoot &&
    path.basename(resolvedTarget).toLowerCase() === STAGE_DROP_MARKER.toLowerCase()
  ) {
    return
  }
  if (!(await hasSafeStagePathParents(stageRoot, resolvedTarget))) {
    return
  }
  if (resolvedTarget === stageRoot) {
    await removeOwnedStageRoot(stageRoot).catch(() => false)
    return
  }

  await fs.rm(resolvedTarget, { recursive: true, force: true })
  let current = path.dirname(resolvedTarget)
  while (current === stageRoot || current.startsWith(stageRoot + path.sep)) {
    const currentStats = await fs.lstat(current).catch(() => null)
    if (!currentStats?.isDirectory() || currentStats.isSymbolicLink()) {
      break
    }

    const remaining = await fs.readdir(current).catch(() => null)
    if (!remaining) {
      break
    }

    if (current === stageRoot) {
      if (remaining.some((name) => name !== STAGE_DROP_MARKER)) {
        break
      }
      await removeOwnedStageRoot(stageRoot).catch(() => false)
      break
    }

    if (remaining.length > 0) {
      break
    }
    await fs.rm(current, { recursive: true, force: true }).catch(() => undefined)
    current = path.dirname(current)
  }
}

/** Cleans staged drop paths for a batch of skipped or cancelled upload intents. */
export async function cleanupStagedDropPaths(paths: string[]): Promise<void> {
  await Promise.all(paths.map((p) => cleanupStagedDropPath(p).catch(() => undefined)))
}

/** Cleans only marked Ferry staging directories, including stale roots left by a previous process. */
export async function cleanupAllStagedDrops(maxAgeMs = 3_600_000): Promise<void> {
  const sessions = [...activeStageSessions.values()]
  activeStageSessions.clear()
  await Promise.all(
    sessions.map(async (session) => {
      await waitForPendingStageOpens(session)
      await closeStageDropStreams(session)
    })
  )
  const tracked = [...activeStageDirs]
  await Promise.all(tracked.map((dir) => removeOwnedStageRoot(dir).catch(() => false)))

  const cutoff = maxAgeMs <= 0 ? Number.POSITIVE_INFINITY : Date.now() - maxAgeMs
  const tmpDir = path.resolve(os.tmpdir())
  const entries = await fs.readdir(tmpDir, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(STAGE_DROP_PREFIX))
      .map(async (entry) => {
        const full = path.join(tmpDir, entry.name)
        if (!(await isOwnedStageRoot(full))) {
          return
        }
        const stats = await fs.lstat(full).catch(() => null)
        if (stats?.isDirectory() && stats.mtimeMs <= cutoff) {
          await removeOwnedStageRoot(full).catch(() => false)
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
  if (dirs.length > MAX_STAGE_DROP_ENTRIES) {
    logSecurityEvent('fs.stage_drop_entry_limit', { count: dirs.length, max: MAX_STAGE_DROP_ENTRIES })
    throw new SshError(
      'VALIDATION',
      `Dropped selection exceeds the ${MAX_STAGE_DROP_ENTRIES}-item staging limit. Use the Local pane for larger transfers.`
    )
  }
  const validatedDirs = dirs.map((dir) => normalizeStageSegments(dir, true))
  const stagedPaths = new Set<string>()
  for (const segments of validatedDirs) {
    reserveStagePaths(stagedPaths, segments, true)
  }
  const stageRoot = await fs.mkdtemp(path.join(os.tmpdir(), STAGE_DROP_PREFIX))
  try {
    await createStageDropOwnershipMarker(stageRoot)
  } catch (err) {
    await fs.rm(stageRoot, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }
  const stageId = randomUUID()
  const createdAt = Date.now()
  const session: StageDropSession = {
    root: stageRoot,
    createdAt,
    lastActivityAt: createdAt,
    pendingOpens: 1,
    pendingOpenWaiters: new Set(),
    topLevelOrder: [],
    topLevelMeta: new Map(),
    writtenPaths: new Set(),
    stagedPaths,
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
    if (activeStageSessions.get(stageId) !== session) {
      throw new SshError('NOT_FOUND', `Staging session "${stageId}" not found or expired`)
    }
  } catch (err) {
    activeStageSessions.delete(stageId)
    await removeOwnedStageRoot(stageRoot).catch(() => false)
    throw err
  } finally {
    finishPendingStageOpen(session)
  }
  return { stageId }
}

/** Records incoming bytes or other progress for an active staging session. */
export function touchStageDropSession(stageId: string): void {
  const session = activeStageSessions.get(stageId)
  if (session) {
    session.lastActivityAt = Date.now()
  }
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
  const dedupeKey = stagePathKey(segments)
  if (session.writtenPaths.has(dedupeKey)) {
    throw new SshError('VALIDATION', `Duplicate staged relative path "${relativePath}"`)
  }
  reserveStagePaths(session.stagedPaths, segments, false)
  session.lastActivityAt = Date.now()
  session.writtenPaths.add(dedupeKey)
  const targetPath = resolveStageTarget(session.root, segments)
  session.pendingOpens += 1
  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    if (activeStageSessions.get(stageId) !== session) {
      throw new SshError('NOT_FOUND', `Staging session "${stageId}" not found or expired`)
    }
  } finally {
    finishPendingStageOpen(session)
  }
  recordStageTopLevel(session.topLevelOrder, session.topLevelMeta, segments, modifiedAt)
  const stream = createWriteStream(targetPath, { highWaterMark: STAGE_WRITE_HIGH_WATER_MARK })
  session.streams.add(stream)
  stream.on('drain', () => {
    session.lastActivityAt = Date.now()
  })
  stream.once('finish', () => {
    session.lastActivityAt = Date.now()
  })
  stream.once('close', () => {
    session.streams.delete(stream)
    session.lastActivityAt = Date.now()
  })
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
  if (session.pendingOpens > 0 || [...session.streams].some((stream) => !stream.writableFinished)) {
    throw new SshError('VALIDATION', 'Cannot finalize a staging session while files are still being written')
  }
  activeStageSessions.delete(stageId)
  await closeStageDropStreams(session)
  try {
    return await buildStageFileEntries(session.root, session.topLevelOrder, session.topLevelMeta)
  } catch (err) {
    await removeOwnedStageRoot(session.root).catch(() => false)
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
  await waitForPendingStageOpens(session)
  await closeStageDropStreams(session)
  await removeOwnedStageRoot(session.root).catch(() => false)
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
  const stagedPaths = new Set<string>()
  for (const item of entries) {
    const isDir = Boolean(item.isDir)
    const segments = normalizeStageSegments(item.relativePath, isDir)
    reserveStagePaths(stagedPaths, segments, isDir)
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
      isDir,
      data: item.isDir ? undefined : bytes,
      modifiedAt: item.modifiedAt
    })
  }

  const stageRoot = await fs.mkdtemp(path.join(os.tmpdir(), STAGE_DROP_PREFIX))
  try {
    await createStageDropOwnershipMarker(stageRoot)
  } catch (err) {
    await fs.rm(stageRoot, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }
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
    await removeOwnedStageRoot(stageRoot).catch(() => false)
    throw err
  }
}
