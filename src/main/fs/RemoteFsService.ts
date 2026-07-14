import { SessionManager } from '../ssh/SessionManager'
import type { SftpEntry } from '../ssh/RemoteShell'
import type { FileEntry, FileListResult, FileReadResult } from '../../shared/contract'

/** Cap on how much of a file is read for preview — huge logs are truncated, not rejected. */
const MAX_TEXT_PREVIEW_BYTES = 1_048_576

function toFileEntry(basePath: string, entry: SftpEntry): FileEntry {
  const trimmed = basePath.length > 1 && basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
  return {
    name: entry.filename,
    path: `${trimmed}/${entry.filename}`,
    isDir: entry.isDirectory,
    size: entry.size,
    modifiedAt: entry.mtimeMs > 0 ? new Date(entry.mtimeMs).toISOString() : null,
    permissions: entry.permissions
  }
}

/**
 * Lists a remote directory over SFTP. Falls back to the session's current
 * working directory when no path is given, and always resolves to a
 * canonical absolute path (via `realpath`) so the renderer's breadcrumb and
 * subsequent relative operations never have to guess at "." semantics.
 */
export async function listRemote(sessionId: string, dirPath?: string): Promise<FileListResult> {
  const manager = SessionManager.getInstance()
  const rawPath = dirPath && dirPath.length > 0 ? dirPath : manager.cwd(sessionId)
  const shell = manager.shell(sessionId)
  const resolved = await shell.realpath(rawPath)
  const entries = (await shell.readdir(resolved))
    .filter((e) => e.filename !== '.' && e.filename !== '..')
    .map((e) => toFileEntry(resolved, e))
  manager.setCwd(sessionId, resolved)
  return { path: resolved, entries }
}

/** Creates a remote directory. */
export async function mkdirRemote(sessionId: string, dirPath: string): Promise<void> {
  await SessionManager.getInstance().shell(sessionId).mkdir(dirPath)
}

/** Renames/moves a remote path. */
export async function renameRemote(sessionId: string, fromPath: string, toPath: string): Promise<void> {
  await SessionManager.getInstance().shell(sessionId).rename(fromPath, toPath)
}

/** Sets a remote path's permissions (mode is an octal string, e.g. "0755"). */
export async function chmodRemote(sessionId: string, targetPath: string, mode: string): Promise<void> {
  await SessionManager.getInstance().shell(sessionId).chmod(targetPath, mode)
}

/** Reads a remote file's content as text, capped at MAX_TEXT_PREVIEW_BYTES. */
export async function readFile(sessionId: string, filePath: string): Promise<FileReadResult> {
  const shell = SessionManager.getInstance().shell(sessionId)
  const result = await shell.readFile(filePath, MAX_TEXT_PREVIEW_BYTES)
  return { path: filePath, ...result }
}

/** Recursively deletes a remote file or directory. */
export async function removeRemote(sessionId: string, targetPath: string): Promise<void> {
  await SessionManager.getInstance().shell(sessionId).deleteRecursive(targetPath)
}
