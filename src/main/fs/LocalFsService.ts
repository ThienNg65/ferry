import { promises as fs } from 'fs'
import * as path from 'path'
import * as os from 'os'
import { SshError } from '../ssh/errors'
import type { FileEntry, FileListResult } from '../../shared/contract'

/** Lists a local directory. Falls back to the OS home directory when no path is given. */
export async function list(dirPath?: string): Promise<FileListResult> {
  const resolved = dirPath && dirPath.length > 0 ? dirPath : os.homedir()
  let dirents
  try {
    dirents = await fs.readdir(resolved, { withFileTypes: true })
  } catch (e) {
    throw new SshError('NOT_FOUND', `Cannot list "${resolved}": ${(e as Error).message}`)
  }

  const entries: FileEntry[] = []
  for (const dirent of dirents) {
    const fullPath = path.join(resolved, dirent.name)
    try {
      const stats = await fs.stat(fullPath)
      entries.push({
        name: dirent.name,
        path: fullPath,
        isDir: dirent.isDirectory(),
        size: stats.size,
        modifiedAt: stats.mtime.toISOString()
      })
    } catch {
      // Entry vanished or became inaccessible mid-listing (e.g. broken symlink) — skip it.
      continue
    }
  }
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
