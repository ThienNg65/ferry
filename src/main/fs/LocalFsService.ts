import { promises as fs } from 'fs'
import * as path from 'path'
import * as os from 'os'
import { SshError } from '../ssh/errors'
import type { FileEntry, FileListResult, FileReadResult, IpcErrorCode, StageDropRequest } from '../../shared/contract'

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
  const resolved = dirPath && dirPath.length > 0 ? dirPath : os.homedir()
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
    await handle.read(buffer, 0, length, 0)
    return {
      path: filePath,
      content: buffer.toString('utf-8'),
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
    throw new SshError('NOT_FOUND', `Cannot list "${dirPath}": ${(e as Error).message}`)
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
const STAGE_DROP_PREFIX = 'ferry-drop-'
const activeStageDirs = new Set<string>()

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

/** Cleans tracked staged drop directories and sweeps stale `ferry-drop-*` folders from `os.tmpdir()`. */
export async function cleanupAllStagedDrops(maxAgeMs = 3_600_000): Promise<void> {
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
 * Stages files/folders dropped from the OS into a temporary local directory when
 * the host runtime (e.g. Neutralino/WebView2) does not expose host filesystem paths
 * on DOM `File` objects, returning top-level `FileEntry` records with real local paths.
 */
export async function stageDroppedEntries(req: StageDropRequest): Promise<FileEntry[]> {
  const entries = Array.isArray(req?.entries) ? req.entries : []
  if (entries.length === 0) {
    return []
  }

  let totalBytes = 0
  const normalized: Array<{ segments: string[]; isDir: boolean; data?: Uint8Array; modifiedAt?: string }> = []
  for (const item of entries) {
    const rawRel = String(item.relativePath ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (!rawRel || /^[a-zA-Z]:/.test(rawRel)) {
      throw new SshError('VALIDATION', `Invalid dropped relative path "${item.relativePath}"`)
    }
    const segments = rawRel.split('/').filter(Boolean)
    if (segments.length === 0 || segments.some((s) => s === '.' || s === '..')) {
      throw new SshError('VALIDATION', `Unsafe dropped relative path "${item.relativePath}"`)
    }
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
      const targetPath = path.resolve(stageRoot, ...item.segments)
      if (!targetPath.startsWith(stageRoot + path.sep)) {
        throw new SshError('VALIDATION', `Escaped staging root for "${item.segments.join('/')}"`)
      }
      const topName = item.segments[0]
      if (!topLevelMeta.has(topName)) {
        topLevelOrder.push(topName)
        topLevelMeta.set(topName, { modifiedAt: item.segments.length === 1 ? item.modifiedAt : undefined })
      }
      if (item.isDir) {
        await fs.mkdir(targetPath, { recursive: true })
      } else {
        await fs.mkdir(path.dirname(targetPath), { recursive: true })
        await fs.writeFile(targetPath, item.data ?? Buffer.alloc(0))
      }
    }
  } catch (err) {
    activeStageDirs.delete(stageRoot)
    await fs.rm(stageRoot, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }

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
