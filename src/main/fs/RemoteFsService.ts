import { randomBytes } from 'crypto'
import { readFile as readLocalFile, writeFile as writeLocalFile } from 'fs/promises'
import { shellEscape } from '../ssh/shellEscape'
import { createReadStream, createWriteStream } from 'fs'
import type { SFTPWrapper } from 'ssh2'
import { SessionManager } from '../ssh/SessionManager'
import { SshError } from '../ssh/errors'
import type { RemoteShell, SftpEntry } from '../ssh/RemoteShell'
import type { FileEntry, FileListResult, FileReadResult } from '../../shared/contract'
import { buildChmodCommand, buildChownCommand } from './permissionCommands'
import type { RemoteAdminRequest } from '../../shared/contract'
import { buildRemoteListCommand, parseRemoteListOutput } from './remoteExecList'

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
 * Tries to list a remote directory via a single remote exec command (Python 3/POSIX).
 * Returns null if the remote system lacks exec capability, the command fails, or the output is unparseable.
 */
async function listRemoteExec(shell: RemoteShell, targetPath: string): Promise<FileListResult | null> {
  try {
    const cmd = buildRemoteListCommand(targetPath)
    const res = await shell.exec(cmd, { timeoutMs: 10_000 })
    if (res.code === 0 && res.stdout) {
      return parseRemoteListOutput(res.stdout)
    }
  } catch {
    // Shell exec disabled, channel rejected, or command timed out
  }
  return null
}

/**
 * Standard SFTP directory listing fallback for restricted accounts or environments
 * without shell exec access.
 */
async function listRemoteSftp(shell: RemoteShell, rawPath: string): Promise<FileListResult> {
  const resolved = await shell.realpath(rawPath)
  const rawEntries = (await shell.readdir(resolved))
    .filter((e) => e.filename !== '.' && e.filename !== '..')
    .map((e) => toFileEntry(resolved, e))
  const entries = await Promise.all(
    rawEntries.map((e) => (e.isSymlink ? resolveSymlink(shell, e) : e))
  )
  return { path: resolved, entries }
}

/**
 * Lists a remote directory using exec-first single-roundtrip execution,
 * falling back to SFTP when exec is unavailable or fails.
 */
export async function listRemote(
  sessionId: string,
  dirPath?: string,
  isPrefetch = false
): Promise<FileListResult> {
  const manager = SessionManager.getInstance()
  const rawPath = dirPath && dirPath.length > 0 ? dirPath : manager.cwd(sessionId)
  const shell = manager.shell(sessionId)

  const execResult = await listRemoteExec(shell, rawPath)
  if (execResult) {
    if (!isPrefetch) {
      manager.setCwd(sessionId, execResult.path)
    }
    return execResult
  }

  const sftpResult = await listRemoteSftp(shell, rawPath)
  if (!isPrefetch) {
    manager.setCwd(sessionId, sftpResult.path)
  }
  return sftpResult
}

/** Creates a remote directory. */
export async function mkdirRemote(sessionId: string, dirPath: string): Promise<void> {
  await SessionManager.getInstance().shell(sessionId).mkdir(dirPath)
}

export async function adminRemote(req: RemoteAdminRequest): Promise<void> {
  const shell = SessionManager.getInstance().shell(req.sessionId)
  const commands: string[] = []
  if (req.mode) {
    commands.push(buildChmodCommand(req.path, req.mode, Boolean(req.recursive)))
  }
  if (req.owner || req.group) {
    commands.push(buildChownCommand(req.path, req.owner ?? '', req.group ?? '', Boolean(req.recursive)))
  }
  for (const command of commands) {
    const result = await shell.exec(command)
    if (result.code !== 0) {
      throw new SshError('SSH_EXEC', result.stderr.trim() || `Command exited with code ${result.code}`)
    }
  }
}

/** Creates an empty remote file, failing if it already exists. */
export async function touchRemote(sessionId: string, filePath: string): Promise<void> {
  await SessionManager.getInstance().shell(sessionId).touch(filePath)
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
  onProgress?: (bytesTransferred: number) => void,
  signal?: AbortSignal
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
    
    const cleanup = (): void => {
      readStream.destroy()
      writeStream.destroy()
    }

    if (signal) {
      if (signal.aborted) {
        cleanup()
        return reject(new Error('Operation cancelled'))
      }
      signal.addEventListener('abort', () => {
        cleanup()
        reject(new Error('Operation cancelled'))
      })
    }

    let bytesTransferred = 0
    readStream.on('data', (chunk: Buffer) => {
      bytesTransferred += chunk.length
      onProgress?.(bytesTransferred)
    })
    readStream.on('error', (e: Error) => {
      cleanup()
      reject(new SshError('SFTP', `Failed to download "${remotePath}": ${e.message}`))
    })
    writeStream.on('error', (e: Error) => {
      cleanup()
      reject(new SshError('UNKNOWN', `Failed to write "${localPath}": ${e.message}`))
    })
    writeStream.on('close', () => resolve())
    readStream.pipe(writeStream)
  })
}

export async function statRemoteForEdit(sessionId: string, remotePath: string): Promise<{ mtime: number; size: number; mode: number } | null> {
  try {
    const stats = await SessionManager.getInstance().shell(sessionId).stat(remotePath)
    return { mtime: stats.mtime ?? 0, size: stats.size ?? 0, mode: stats.mode & 0o7777 }
  } catch {
    return null
  }
}

function writeRemoteFile(sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const readStream = createReadStream(localPath)
    const writeStream = sftp.createWriteStream(remotePath)
    readStream.on('error', (e: Error) => {
      writeStream.destroy()
      reject(new SshError('UNKNOWN', `Failed to read "${localPath}": ${e.message}`))
    })
    writeStream.on('error', (e: Error) => reject(new SshError('SFTP', `Failed to upload to "${remotePath}": ${e.message}`)))
    writeStream.on('close', () => resolve())
    readStream.pipe(writeStream)
  })
}

function posixRename(sftp: SFTPWrapper, from: string, to: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    try {
      sftp.ext_openssh_rename(from, to, (e) => (e ? reject(e) : resolve(true)))
    } catch {
      resolve(false)
    }
  })
}

function resolveRemotePath(sftp: SFTPWrapper, remotePath: string): Promise<string> {
  return new Promise((resolve) => sftp.realpath(remotePath, (e, abs) => resolve(e ? remotePath : abs)))
}

async function replaceRemoteFile(shell: RemoteShell, tempPath: string, target: string, hadTarget: boolean): Promise<void> {
  if (!hadTarget) {
    await shell.rename(tempPath, target)
    return
  }
  const backup = `${target}.ferry-bak-${randomBytes(4).toString('hex')}`
  await shell.rename(target, backup)
  try {
    await shell.rename(tempPath, target)
  } catch (e) {
    await shell.rename(backup, target).catch(() => undefined)
    throw e
  }
  await shell.unlink(backup).catch(() => undefined)
}

export async function commitRemoteFile(shell: RemoteShell, tempPath: string, target: string): Promise<void> {
  const sftp = await shell.sftp()
  const resolved = await resolveRemotePath(sftp, target)
  const existing = await shell.stat(resolved).then((s) => s, () => null)
  if (existing) {
    await shell.chmod(tempPath, (existing.mode & 0o7777).toString(8).padStart(4, '0'))
  }
  if (!(await posixRename(sftp, tempPath, resolved))) {
    await replaceRemoteFile(shell, tempPath, resolved, existing !== null)
  }
}

async function sudoExec(shell: RemoteShell, command: string, input?: Buffer, prefix = ''): Promise<Buffer> {
  const result = await shell.execWithStdin(`${prefix}sudo -n ${command}`, input)
  if (result.code !== 0) {
    const message = result.stderr.trim()
    if (/password is required|a terminal is required|no tty present/i.test(message)) {
      throw new SshError('SSH_EXEC', 'Passwordless sudo is required to edit as root')
    }
    throw new SshError('SSH_EXEC', message || `sudo exited with code ${result.code}`)
  }
  return result.stdout
}

export async function statRemoteSudo(sessionId: string, remotePath: string): Promise<{ mtime: number; size: number } | null> {
  try {
    const shell = SessionManager.getInstance().shell(sessionId)
    const out = (await sudoExec(shell, `stat -c '%Y %s' -- ${shellEscape(remotePath)}`)).toString().trim()
    const [mtime, size] = out.split(' ').map(Number)
    return Number.isFinite(mtime) && Number.isFinite(size) ? { mtime, size } : null
  } catch {
    return null
  }
}

export async function downloadForEditSudo(sessionId: string, remotePath: string, localPath: string): Promise<void> {
  const shell = SessionManager.getInstance().shell(sessionId)
  const content = await sudoExec(shell, `cat -- ${shellEscape(remotePath)}`)
  await writeLocalFile(localPath, content, { mode: 0o600 })
}

export async function uploadForEditSudo(sessionId: string, localPath: string, remotePath: string): Promise<void> {
  const shell = SessionManager.getInstance().shell(sessionId)
  const data = await readLocalFile(localPath)
  const target = shellEscape(remotePath)
  const temp = shellEscape(`${remotePath}.ferry-tmp-${randomBytes(4).toString('hex')}`)
  try {
    await sudoExec(shell, `tee -- ${temp} > /dev/null`, data, 'umask 077; ')
    await sudoExec(shell, `chmod --reference=${target} -- ${temp}`)
    await sudoExec(shell, `chown --reference=${target} -- ${temp}`)
    await sudoExec(shell, `mv -f -- ${temp} ${target}`)
  } catch (e) {
    await sudoExec(shell, `rm -f -- ${temp}`).catch(() => undefined)
    throw e
  }
}

export async function uploadForEdit(sessionId: string, localPath: string, remotePath: string): Promise<void> {
  const shell = SessionManager.getInstance().shell(sessionId)
  const sftp = await shell.sftp()
  const target = await resolveRemotePath(sftp, remotePath)
  const existing = await statRemoteForEdit(sessionId, target)
  const tempPath = `${target}.ferry-tmp-${randomBytes(4).toString('hex')}`
  try {
    try {
      await writeRemoteFile(sftp, localPath, tempPath)
    } catch (e) {
      if (existing && /permission denied/i.test(e instanceof Error ? e.message : '')) {
        await writeRemoteFile(sftp, localPath, target)
        return
      }
      throw e
    }
    if (existing) {
      await shell.chmod(tempPath, existing.mode.toString(8).padStart(4, '0'))
    }
    if (!(await posixRename(sftp, tempPath, target))) {
      await replaceRemoteFile(shell, tempPath, target, existing !== null)
    }
  } catch (e) {
    await shell.unlink(tempPath).catch(() => undefined)
    throw e
  }
}
