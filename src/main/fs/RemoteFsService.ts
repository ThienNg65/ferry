import { randomBytes } from 'crypto'
import { readFile as readLocalFile, writeFile as writeLocalFile } from 'fs/promises'
import * as path from 'path'
import { shellEscape } from '../ssh/shellEscape'
import { createReadStream, createWriteStream } from 'fs'
import type { SFTPWrapper, Stats } from 'ssh2'
import { SessionManager } from '../ssh/SessionManager'
import { SshError } from '../ssh/errors'
import type { RemoteShell, SftpEntry } from '../ssh/RemoteShell'
import type {
  CopyManyResult,
  FileEntry,
  FileListResult,
  FileReadResult,
  MonitorDiskUsage,
  RemoteAdminRequest
} from '../../shared/contract'
import { parseDiskUsage, splitSections } from '../monitor/procParse'
import { pickUniqueName } from '../../shared/uniqueName'
import { buildChmodCommand, buildChownCommand } from './permissionCommands'
import { buildRemoteListCommand, parseRemoteListOutput } from './remoteExecList'

/** Cap on how much of a file is read for preview — huge logs are truncated, not rejected. */
const MAX_TEXT_PREVIEW_BYTES = 1_048_576

function toFileEntry(basePath: string, entry: SftpEntry): FileEntry | null {
  if (
    !entry.filename ||
    entry.filename === '.' ||
    entry.filename === '..' ||
    entry.filename.includes('/') ||
    entry.filename.includes('\\')
  ) {
    return null
  }
  const prefix = basePath === '/' ? '' : basePath.replace(/\/+$/, '')
  return {
    name: entry.filename,
    path: `${prefix}/${entry.filename}`,
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
    .filter((entry): entry is FileEntry => entry !== null)
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
export async function renameRemote(sessionId: string, fromPath: string, toPath: string, replace?: boolean): Promise<void> {
  const shell = SessionManager.getInstance().shell(sessionId)
  if (replace === undefined) {
    await shell.rename(fromPath, toPath)
    return
  }

  const destination = await shell.lstat(toPath).catch((e: unknown) => {
    if (!(e instanceof SshError) || e.code !== 'NOT_FOUND') throw e
    return null
  })
  if (!destination) {
    await shell.rename(fromPath, toPath)
    return
  }
  if (!replace) throw new SshError('ALREADY_EXISTS', `"${toPath}" already exists.`)
  if (await posixRename(await shell.sftp(), fromPath, toPath)) return

  const source = await shell.lstat(fromPath)
  if (destination.isDirectory() || source.isDirectory()) {
    throw new SshError('SFTP', 'This server cannot replace folders during rename. Choose an unused name.')
  }
  await replaceRemoteFile(shell, fromPath, toPath, true)
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

/**
 * Stats a remote path and reads its raw bytes only if it is a regular file within `maxBytes`.
 * Oversized files and directories return metadata without opening an SFTP read stream.
 */
export async function readRemoteBufferForDiff(
  sessionId: string,
  remotePath: string,
  maxBytes: number
): Promise<{ size: number; isDir: boolean; buffer?: Buffer }> {
  const shell = SessionManager.getInstance().shell(sessionId)
  const stats = await shell.stat(remotePath)
  const size = stats.size ?? 0
  if (stats.isDirectory()) {
    return { size, isDir: true }
  }
  if (size > maxBytes) {
    return { size, isDir: false }
  }
  const { buffer } = await shell.readFileBuffer(remotePath, maxBytes, stats)
  return { size, isDir: false, buffer }
}

/** Recursively deletes a remote file or directory. */
export async function removeRemote(sessionId: string, targetPath: string): Promise<void> {
  const manager = SessionManager.getInstance()
  await manager.shell(sessionId).deleteRecursive(targetPath, manager.cwd(sessionId))
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
    
    let settled = false
    let finished = false
    const onAbort = (): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('Operation cancelled'))
    }
    const cleanup = (): void => {
      signal?.removeEventListener('abort', onAbort)
      readStream.destroy()
      writeStream.destroy()
    }

    if (signal) {
      if (signal.aborted) {
        cleanup()
        return reject(new Error('Operation cancelled'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    let bytesTransferred = 0
    readStream.on('data', (chunk: Buffer) => {
      bytesTransferred += chunk.length
      onProgress?.(bytesTransferred)
    })
    readStream.on('error', (e: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new SshError('SFTP', `Failed to download "${remotePath}": ${e.message}`))
    })
    writeStream.on('error', (e: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new SshError('UNKNOWN', `Failed to write "${localPath}": ${e.message}`))
    })
    writeStream.on('finish', () => {
      finished = true
    })
    writeStream.on('close', () => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      if (!finished) {
        reject(new SshError('UNKNOWN', `Download stream for "${localPath}" closed before finishing`))
        return
      }
      resolve()
    })
    readStream.pipe(writeStream)
  })
}

export async function statRemoteForEdit(sessionId: string, remotePath: string): Promise<{ mtime: number; size: number; mode: number | null } | null> {
  try {
    const stats = await SessionManager.getInstance().shell(sessionId).stat(remotePath)
    return {
      mtime: stats.mtime ?? 0,
      size: stats.size ?? 0,
      mode: typeof stats.mode === 'number' ? stats.mode & 0o7777 : null
    }
  } catch {
    return null
  }
}

function writeRemoteFile(sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // ssh2's automatic close destroys the writable in _final, suppressing
    // Node's finish event. Close it explicitly after the writes finish.
    const writeStream = sftp.createWriteStream(remotePath, { autoClose: false })
    const readStream = createReadStream(localPath)
    let settled = false
    let finished = false
    const fail = (error: SshError): void => {
      if (settled) return
      settled = true
      readStream.unpipe(writeStream)
      readStream.destroy()
      writeStream.destroy()
      reject(error)
    }
    readStream.on('error', (e: Error) => {
      fail(new SshError('UNKNOWN', `Failed to read "${localPath}": ${e.message}`))
    })
    writeStream.on('error', (e: Error) => {
      fail(new SshError('SFTP', `Failed to upload to "${remotePath}": ${e.message}`))
    })
    writeStream.on('finish', () => {
      finished = true
      writeStream.destroy()
    })
    writeStream.on('close', () => {
      if (settled) return
      if (!finished) {
        fail(new SshError('SFTP', 'Upload stream closed before finishing'))
        return
      }
      settled = true
      resolve()
    })
    readStream.pipe(writeStream)
  })
}

function posixRename(sftp: SFTPWrapper, from: string, to: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    try {
      // Extension failures fall back to the standard SFTP replacement path.
      sftp.ext_openssh_rename(from, to, (e) => resolve(!e))
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
    try {
      await shell.rename(backup, target)
    } catch {
      throw new SshError('SFTP', `Could not restore "${target}". Its previous contents are at "${backup}".`)
    }
    throw e
  }
  await shell.unlink(backup).catch(() => undefined)
}

export async function commitRemoteFile(shell: RemoteShell, tempPath: string, target: string): Promise<void> {
  const sftp = await shell.sftp()
  const resolved = await resolveRemotePath(sftp, target)
  const existing = await shell.stat(resolved).then((s) => s, () => null)
  if (existing && typeof existing.mode === 'number') {
    const existingMode = existing.mode & 0o7777
    await shell.chmod(tempPath, existingMode.toString(8).padStart(4, '0')).catch(() => undefined)
  }
  if (!(await posixRename(sftp, tempPath, resolved))) {
    await replaceRemoteFile(shell, tempPath, resolved, existing !== null)
  }
}

async function sudoExec(
  shell: RemoteShell,
  command: string,
  input?: Buffer,
  prefix = '',
  opts?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<Buffer> {
  const result = await shell.execWithStdin(`${prefix}sudo -n ${command}`, input, opts)
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

export async function downloadForEditSudo(
  sessionId: string,
  remotePath: string,
  localPath: string,
  signal?: AbortSignal
): Promise<void> {
  const shell = SessionManager.getInstance().shell(sessionId)
  const content = await sudoExec(shell, `cat -- ${shellEscape(remotePath)}`, undefined, '', { signal })
  await writeLocalFile(localPath, content, { mode: 0o600 })
}

/**
 * Sudo counterpart to {@link readRemoteBufferForDiff} for files opened with "Edit as root".
 * Checks type and byte size via `sudo -n stat` before streaming bytes via `cat`.
 */
export async function readRemoteBufferForDiffSudo(
  sessionId: string,
  remotePath: string,
  maxBytes: number
): Promise<{ size: number; isDir: boolean; buffer?: Buffer }> {
  const shell = SessionManager.getInstance().shell(sessionId)
  let statOut: string
  try {
    statOut = (await sudoExec(shell, `stat -L -c '%F|%s' -- ${shellEscape(remotePath)}`)).toString('utf-8').trim()
  } catch (e) {
    if (e instanceof SshError && /no such file/i.test(e.message)) {
      throw new SshError('NOT_FOUND', `"${remotePath}" not found`)
    }
    throw e
  }
  const sep = statOut.lastIndexOf('|')
  const fileType = sep >= 0 ? statOut.slice(0, sep).trim() : ''
  const size = Number(sep >= 0 ? statOut.slice(sep + 1).trim() : NaN)
  if (/directory/i.test(fileType)) {
    return { size: Number.isFinite(size) ? size : 0, isDir: true }
  }
  if (!Number.isFinite(size) || size < 0) {
    throw new SshError('SSH_EXEC', `Could not stat "${remotePath}" via sudo`)
  }
  if (size > maxBytes) {
    return { size, isDir: false }
  }
  if (size === 0) {
    return { size: 0, isDir: false, buffer: Buffer.alloc(0) }
  }
  const buffer = await sudoExec(shell, `cat -- ${shellEscape(remotePath)}`)
  return { size, isDir: false, buffer }
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
    await writeRemoteFile(sftp, localPath, tempPath)
    if (existing && existing.mode !== null) {
      await shell.chmod(tempPath, existing.mode.toString(8).padStart(4, '0')).catch(() => undefined)
    }
    if (!(await posixRename(sftp, tempPath, target))) {
      await replaceRemoteFile(shell, tempPath, target, existing !== null)
    }
  } catch (e) {
    await shell.unlink(tempPath).catch(() => undefined)
    throw e
  }
}

const SFTP_OPEN_TIMEOUT_MS = 30_000
const SFTP_CLOSE_TIMEOUT_MS = 10_000
const SFTP_COPY_DATA_TIMEOUT_MS = 120_000

function normalizePosixPath(p: string): string {
  const trimmed = (p ?? '').trim()
  if (!trimmed || !trimmed.startsWith('/')) return ''
  const normalized = path.posix.normalize(trimmed)
  return normalized === '/' ? '/' : normalized.replace(/\/+$/, '') || '/'
}

function withSftpOpTimeout<T>(
  label: string,
  timeoutMs: number,
  run: (resolve: (value: T) => void, reject: (err: unknown) => void) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new SshError('SSH_TIMEOUT', `${label} timed out after ${timeoutMs}ms`, true))
    }, timeoutMs)
    run(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

function sftpOpen(sftp: SFTPWrapper, filePath: string, flags: 'r' | 'wx'): Promise<Buffer> {
  return withSftpOpTimeout<Buffer>(`SFTP open "${filePath}"`, SFTP_OPEN_TIMEOUT_MS, (resolve, reject) => {
    sftp.open(filePath, flags, (err, handle) => {
      if (err) reject(err)
      else resolve(handle)
    })
  })
}

function sftpClose(sftp: SFTPWrapper, handle: Buffer): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve()
    }, SFTP_CLOSE_TIMEOUT_MS)
    sftp.close(handle, () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    })
  })
}

async function trySftpCopyData(
  shell: RemoteShell,
  sftp: SFTPWrapper,
  srcPath: string,
  destPath: string,
  state: { copyDataSupported: boolean }
): Promise<boolean> {
  if (!state.copyDataSupported || typeof sftp.ext_copy_data !== 'function') {
    state.copyDataSupported = false
    return false
  }
  let srcHandle: Buffer | null = null
  let destHandle: Buffer | null = null
  let destCreated = false
  try {
    srcHandle = await sftpOpen(sftp, srcPath, 'r')
    destHandle = await sftpOpen(sftp, destPath, 'wx')
    destCreated = true
    await withSftpOpTimeout<void>(`SFTP copy "${srcPath}"`, SFTP_COPY_DATA_TIMEOUT_MS, (resolve, reject) => {
      sftp.ext_copy_data(srcHandle!, 0, 0, destHandle!, 0, (err) => {
        if (err) {
          state.copyDataSupported = false
          reject(err)
        } else {
          resolve()
        }
      })
    })
    return true
  } catch {
    // Close open handles before unlinking so Windows SFTP servers can delete destPath.
    if (destHandle) {
      const h = destHandle
      destHandle = null
      await sftpClose(sftp, h)
    }
    if (srcHandle) {
      const h = srcHandle
      srcHandle = null
      await sftpClose(sftp, h)
    }
    if (destCreated) {
      await shell.unlink(destPath).catch(() => undefined)
    }
    return false
  } finally {
    if (destHandle) await sftpClose(sftp, destHandle)
    if (srcHandle) await sftpClose(sftp, srcHandle)
  }
}

async function streamRemoteFileCopy(
  shell: RemoteShell,
  sftp: SFTPWrapper,
  srcPath: string,
  destPath: string,
  signal?: AbortSignal
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const readStream = sftp.createReadStream(srcPath)
    // Match writeRemoteFile: autoClose: false preserves Node's 'finish' event on ssh2 write streams.
    const writeStream = sftp.createWriteStream(destPath, { autoClose: false })
    let settled = false
    let finished = false

    const cleanup = (): void => {
      signal?.removeEventListener('abort', onAbort)
      readStream.unpipe(writeStream)
      readStream.destroy()
      writeStream.destroy()
    }
    const fail = (err: SshError): void => {
      if (settled) return
      settled = true
      cleanup()
      void shell.unlink(destPath).catch(() => undefined)
      reject(err)
    }
    const onAbort = (): void => fail(new SshError('CANCELLED', 'Copy cancelled'))

    if (signal?.aborted) {
      cleanup()
      reject(new SshError('CANCELLED', 'Copy cancelled'))
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    readStream.on('error', (e: Error) => {
      fail(new SshError('SFTP', `Failed to read "${srcPath}": ${e.message}`))
    })
    writeStream.on('error', (e: Error) => {
      fail(new SshError('SFTP', `Failed to write "${destPath}": ${e.message}`))
    })
    writeStream.on('finish', () => {
      finished = true
      writeStream.destroy()
    })
    writeStream.on('close', () => {
      if (settled) return
      if (!finished) {
        fail(new SshError('SFTP', `Copy stream for "${destPath}" closed before finishing`))
        return
      }
      settled = true
      signal?.removeEventListener('abort', onAbort)
      resolve()
    })
    readStream.pipe(writeStream)
  })
}

async function copyRemoteSftp(
  shell: RemoteShell,
  srcPath: string,
  destPath: string,
  srcStat: Stats,
  state: { copyDataSupported: boolean },
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) {
    throw new SshError('CANCELLED', 'Copy cancelled')
  }
  const sftp = await shell.sftp()
  if (srcStat.isSymbolicLink()) {
    const target = await shell.readlink(srcPath)
    await withSftpOpTimeout<void>(`SFTP symlink "${destPath}"`, SFTP_OPEN_TIMEOUT_MS, (resolve, reject) => {
      sftp.symlink(target, destPath, (err) => {
        if (err) reject(new SshError('SFTP', `Failed to copy symlink "${srcPath}": ${err.message}`))
        else resolve()
      })
    })
    return
  }
  if (srcStat.isDirectory()) {
    await shell.mkdir(destPath)
    const entries = await shell.readdir(srcPath)
    for (const entry of entries) {
      if (entry.filename === '.' || entry.filename === '..') continue
      if (!entry.filename || entry.filename.includes('/') || entry.filename.includes('\\')) {
        throw new SshError('SFTP', `Refusing to copy unsafe remote entry name "${entry.filename}" under "${srcPath}"`)
      }
      const childSrc = `${srcPath === '/' ? '' : srcPath}/${entry.filename}`
      const childDest = `${destPath === '/' ? '' : destPath}/${entry.filename}`
      const childStat = await shell.lstat(childSrc)
      await copyRemoteSftp(shell, childSrc, childDest, childStat, state, signal)
    }
    return
  }
  if (await trySftpCopyData(shell, sftp, srcPath, destPath, state)) {
    return
  }
  await streamRemoteFileCopy(shell, sftp, srcPath, destPath, signal)
}

/**
 * Copies remote files/folders into `targetDir` using server-side SFTP `ext_copy_data`
 * (for regular files), `cp -Rp --` over SSH exec, or recursive SFTP stream fallback.
 */
export async function copyRemote(
  sessionId: string,
  sourcePaths: string[],
  targetDir: string,
  options?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }
): Promise<CopyManyResult> {
  const resolvedTargetDir = normalizePosixPath(targetDir)
  if (!resolvedTargetDir) {
    throw new SshError('VALIDATION', 'Target directory must be an absolute remote path')
  }
  const shell = SessionManager.getInstance().shell(sessionId)
  const targetStat = await shell.stat(resolvedTargetDir)
  if (!targetStat.isDirectory()) {
    throw new SshError('VALIDATION', `Target "${resolvedTargetDir}" is not a directory`)
  }
  const existing = await shell.readdir(resolvedTargetDir)
  const taken = new Set(existing.filter((e) => e.filename !== '.' && e.filename !== '..').map((e) => e.filename))
  const copyState = { copyDataSupported: true }

  const result: CopyManyResult = { copied: [], failures: [] }
  let done = 0
  for (const rawSource of sourcePaths) {
    if (options?.signal?.aborted) {
      throw new SshError('CANCELLED', 'Copy cancelled')
    }
    try {
      const src = normalizePosixPath(rawSource)
      if (!src || src === '/') {
        throw new SshError('VALIDATION', `Refusing to copy root, relative, or empty path "${rawSource}"`)
      }
      const baseName = path.posix.basename(src)
      if (!baseName || baseName === '.' || baseName === '..') {
        throw new SshError('VALIDATION', `Invalid source path "${rawSource}"`)
      }
      const srcStat = await shell.lstat(src)
      const isDir = srcStat.isDirectory()
      if (isDir && (resolvedTargetDir === src || resolvedTargetDir.startsWith(`${src}/`))) {
        throw new SshError('VALIDATION', 'Cannot copy a folder into itself or one of its subdirectories.')
      }
      const prefix = resolvedTargetDir === '/' ? '' : resolvedTargetDir
      let destName = pickUniqueName(baseName, isDir, taken, false)
      let destPath = `${prefix}/${destName}`
      while (
        await shell.lstat(destPath).then(
          () => true,
          (e: unknown) => {
            if (e instanceof SshError && e.code === 'NOT_FOUND') return false
            throw e
          }
        )
      ) {
        destName = pickUniqueName(baseName, isDir, taken, false)
        destPath = `${prefix}/${destName}`
      }

      let copied = false
      if (!isDir && !srcStat.isSymbolicLink()) {
        copied = await trySftpCopyData(shell, await shell.sftp(), src, destPath, copyState)
      }
      if (!copied) {
        try {
          const execRes = await shell.exec(`cp -Rp -- ${shellEscape(src)} ${shellEscape(destPath)}`, {
            timeoutMs: 120_000,
            signal: options?.signal
          })
          if (execRes.code === 0) {
            copied = true
          } else if (execRes.code !== 126 && execRes.code !== 127) {
            throw new SshError('SSH_EXEC', execRes.stderr.trim() || `Remote copy exited with code ${execRes.code}`)
          }
        } catch (e) {
          if (e instanceof SshError && (e.code === 'CANCELLED' || e.code === 'SSH_TIMEOUT' || e.code === 'SSH_EXEC')) {
            throw e
          }
        }
      }
      if (!copied) {
        await copyRemoteSftp(shell, src, destPath, srcStat, copyState, options?.signal)
      }
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

const DISK_USAGE_CACHE_TTL_MS = 10_000
const DISK_USAGE_TIMEOUT_MS = 2_500
const diskUsageCache = new Map<string, { expiresAt: number; value: MonitorDiskUsage | null }>()

/** Clears cached `df` entries for a closed/reconnected SSH session. */
export function clearDiskUsageCache(sessionId: string): void {
  const prefix = `${sessionId}\0`
  for (const key of diskUsageCache.keys()) {
    if (key.startsWith(prefix)) {
      diskUsageCache.delete(key)
    }
  }
}

/**
 * Queries on-demand remote filesystem capacity (`df -Pk` + `df -Pi`) for `targetPath`,
 * cached briefly per session+path so pre-flight checks work even when Monitor is closed.
 */
export async function diskUsageRemote(sessionId: string, targetPath: string): Promise<MonitorDiskUsage | null> {
  const cleanTarget = targetPath.trim() || '/'
  const cacheKey = `${sessionId}\0${cleanTarget}`
  const now = Date.now()
  const cached = diskUsageCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return cached.value
  }

  let shell: RemoteShell
  try {
    shell = SessionManager.getInstance().shell(sessionId)
  } catch {
    return null
  }

  try {
    const quoted = shellEscape(cleanTarget)
    const cmd = `df -Pk -- ${quoted} 2>/dev/null || df -Pk / 2>/dev/null; echo @@@; df -Pi -- ${quoted} 2>/dev/null || true`
    const res = await shell.exec(cmd, { timeoutMs: DISK_USAGE_TIMEOUT_MS })
    const [pkText, piText] = splitSections(res.stdout, 2)
    const parsed = parseDiskUsage(pkText, piText)
    diskUsageCache.set(cacheKey, { expiresAt: now + DISK_USAGE_CACHE_TTL_MS, value: parsed })
    return parsed
  } catch {
    return null
  }
}
