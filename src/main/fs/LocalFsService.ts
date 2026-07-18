import { promises as fs } from 'fs'
import * as path from 'path'
import * as os from 'os'
import { SshError } from '../ssh/errors'
import type { FileEntry, FileListResult, FileReadResult } from '../../shared/contract'

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
      try {
        const stats = await fs.stat(fullPath)
        return {
          name: dirent.name,
          path: fullPath,
          isDir: dirent.isDirectory(),
          size: stats.size,
          modifiedAt: stats.mtime.toISOString()
        }
      } catch {
        // Entry vanished or became inaccessible mid-listing (e.g. broken symlink) — skip it.
        return null
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

/** Deletes a local file or directory (recursively for directories). */
export async function remove(targetPath: string, isDir: boolean): Promise<void> {
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
        results.push({ relPath, isDir: false, size: stats.size })
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
