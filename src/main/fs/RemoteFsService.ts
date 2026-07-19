import { createReadStream, createWriteStream } from 'fs'
import { SessionManager } from '../ssh/SessionManager'
import { SshError } from '../ssh/errors'
import type { RemoteShell, SftpEntry } from '../ssh/RemoteShell'
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
    permissions: entry.permissions,
    isSymlink: entry.isSymlink
  }
}

/**
 * Resolves a symlink entry's target and, since SFTP `readdir` returns
 * lstat-style attrs (a symlinked directory looks like a file), its *resolved*
 * type via `stat` (which follows the link) — so the renderer's `isDir` always
 * reflects what double-clicking the entry would actually navigate into.
 * Falls back to `symlinkBroken: true` (dangling or circular target) rather
 * than hiding the entry.
 */
async function resolveSymlink(shell: RemoteShell, entry: FileEntry): Promise<FileEntry> {
  const symlinkTarget = await shell.readlink(entry.path).catch(() => undefined)
  try {
    const stats = await shell.stat(entry.path)
    return { ...entry, isDir: stats.isDirectory(), size: stats.size ?? 0, symlinkTarget }
  } catch {
    return { ...entry, isDir: false, symlinkTarget, symlinkBroken: true }
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
  const rawEntries = (await shell.readdir(resolved))
    .filter((e) => e.filename !== '.' && e.filename !== '..')
    .map((e) => toFileEntry(resolved, e))
  const entries = await Promise.all(
    rawEntries.map((e) => (e.isSymlink ? resolveSymlink(shell, e) : e))
  )
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

/**
 * Downloads a remote file's FULL content to a local path — unlike
 * {@link readFile}, which is hard-capped at `MAX_TEXT_PREVIEW_BYTES` for the
 * preview dialog and must never be reused here (it would silently truncate
 * whatever the user then edits and re-uploads). Used by edit-in-external-
 * editor, not the transfer queue (which is fire-and-forget and has no
 * awaitable completion an editor-open flow could wait on).
 */
export async function downloadForEdit(
  sessionId: string,
  remotePath: string,
  localPath: string,
  onProgress?: (bytesTransferred: number) => void
): Promise<void> {
  const shell = SessionManager.getInstance().shell(sessionId)
  const sftp = await shell.sftp()
  await new Promise<void>((resolve, reject) => {
    const readStream = sftp.createReadStream(remotePath)
    // Restrictive mode (POSIX only — see EditSessionManager.ts's temp dir
    // for the same reasoning): the remote file's content may be sensitive,
    // and the default createWriteStream mode is world-readable on a typical
    // shared-/tmp Linux/macOS setup.
    const writeStream = createWriteStream(localPath, { mode: 0o600 })
    let bytesTransferred = 0
    readStream.on('data', (chunk: Buffer) => {
      bytesTransferred += chunk.length
      onProgress?.(bytesTransferred)
    })
    readStream.on('error', (e: Error) => reject(new SshError('SFTP', `Failed to download "${remotePath}": ${e.message}`)))
    writeStream.on('error', (e: Error) => reject(new SshError('UNKNOWN', `Failed to write "${localPath}": ${e.message}`)))
    writeStream.on('close', () => resolve())
    readStream.pipe(writeStream)
  })
}

/** Re-uploads a locally-edited file's FULL content back to its remote path — the other half of edit-in-external-editor. */
export async function uploadForEdit(sessionId: string, localPath: string, remotePath: string): Promise<void> {
  const shell = SessionManager.getInstance().shell(sessionId)
  const sftp = await shell.sftp()
  await new Promise<void>((resolve, reject) => {
    const readStream = createReadStream(localPath)
    const writeStream = sftp.createWriteStream(remotePath)
    readStream.on('error', (e: Error) => reject(new SshError('UNKNOWN', `Failed to read "${localPath}": ${e.message}`)))
    writeStream.on('error', (e: Error) => reject(new SshError('SFTP', `Failed to upload to "${remotePath}": ${e.message}`)))
    writeStream.on('close', () => resolve())
    readStream.pipe(writeStream)
  })
}
