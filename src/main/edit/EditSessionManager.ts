import { randomUUID } from 'crypto'
import { promises as fs, watch, type FSWatcher } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { host } from '../host/host'
import { logSecurityEvent } from '../host/securityLog'
import { SessionManager } from '../ssh/SessionManager'
import { OperationRegistry } from '../operations/OperationRegistry'
import {
  downloadForEdit,
  downloadForEditSudo,
  statRemoteForEdit,
  statRemoteSudo,
  uploadForEdit,
  uploadForEditSudo
} from '../fs/RemoteFsService'
import { SshError } from '../ssh/errors'
import { EVENT_CHANNELS, type EditEvent, type OpenEditSnapshot } from '../../shared/contract'

const WINDOWS_RESERVED_NAME_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i

/** Sanitizes a remote filename for safe local temp-file creation (strips POSIX/Windows separators, traversal, and reserved/control chars). */
export function sanitizeEditFilename(remotePath: string): string {
  const raw = remotePath.split(/[/\\]/).filter(Boolean).pop() ?? 'file'
  const cleaned = raw.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return 'file'
  }
  return WINDOWS_RESERVED_NAME_RE.test(cleaned) ? `_${cleaned}` : cleaned
}

function sanitizeSessionSegment(sessionId: string): string {
  const cleaned = sessionId.replace(/[^A-Za-z0-9_-]/g, '')
  if (!cleaned) {
    throw new SshError('VALIDATION', 'Invalid sessionId for edit session')
  }
  return cleaned
}

/** Debounce window after the last file-change before re-uploading — many editors write-then-rename on save, firing several raw fs events per save. */
const REUPLOAD_DEBOUNCE_MS = 450

function localRevision(stats: { mtimeMs: number; ctimeMs: number; size: number; ino: number }): string {
  return `${stats.mtimeMs}:${stats.ctimeMs}:${stats.size}:${stats.ino}`
}

interface EditEntry {
  editId: string
  sessionId: string
  remotePath: string
  localTempPath: string
  watcher: FSWatcher | null
  debounceTimer: ReturnType<typeof setTimeout> | null
  /** File metadata from the initial download or the most recent successful upload. */
  lastSyncedRevision: string
  remoteStamp: { mtime: number; size: number } | null
  conflictNotified: boolean
  /** True once the underlying SSH session has closed — the watcher is stopped but the temp file is kept. */
  sessionClosed: boolean
  viaSudo: boolean
  uploading: boolean
  pendingReupload: boolean
  pendingForce: boolean
}

/**
 * EditSessionManager — "open a remote file in your OS's default editor and
 * sync it back on save," modeled on TailManager's per-id registry/lifecycle
 * shape. An edit session is long-lived (stays open across many saves, not
 * one-shot) and is torn down only when the app quits or the file is
 * explicitly closed — a dropped SSH session stops syncing but never deletes
 * the user's in-progress edit.
 */
export class EditSessionManager {
  private static instance: EditSessionManager | null = null
  private readonly edits = new Map<string, EditEntry>()
  private readonly pendingOpens = new Map<string, Promise<{ editId: string; localTempPath: string }>>()

  static getInstance(): EditSessionManager {
    if (EditSessionManager.instance === null) {
      EditSessionManager.instance = new EditSessionManager()
    }
    return EditSessionManager.instance
  }

  private broadcast(evt: EditEvent): void {
    host().broadcast(EVENT_CHANNELS.editEvent, evt)
  }

  /** Opens a LOCAL file directly in the OS default app — the local file already is the source of truth, so no temp copy or watcher is needed. */
  async openLocal(localPath: string): Promise<void> {
    const result = await host().openPath(localPath)
    if (result) {
      throw new SshError('UNKNOWN', `Could not open "${localPath}": ${result}`)
    }
  }

  /** Opens a REMOTE file: downloads it in full to a temp path, opens it in the OS default app (unless builtin is true), then watches it and re-uploads on every save. */
  async openRemote(sessionId: string, remotePath: string, builtin: boolean = false, viaSudo: boolean = false): Promise<{ editId: string; localTempPath: string }> {
    const existing = [...this.edits.values()].find((e) => e.sessionId === sessionId && e.remotePath === remotePath && e.viaSudo === viaSudo)
    if (existing) {
      if (!builtin) {
        const result = await host().openPath(existing.localTempPath)
        if (result) {
          throw new SshError('UNKNOWN', `Could not open "${existing.localTempPath}": ${result}`)
        }
      }
      return { editId: existing.editId, localTempPath: existing.localTempPath }
    }

    const dedupKey = `${sessionId}:${viaSudo ? '1' : '0'}:${remotePath}`
    const inflight = this.pendingOpens.get(dedupKey)
    if (inflight) {
      const opened = await inflight
      if (!builtin) {
        const result = await host().openPath(opened.localTempPath)
        if (result) {
          throw new SshError('UNKNOWN', `Could not open "${opened.localTempPath}": ${result}`)
        }
      }
      return opened
    }

    const openPromise = (async (): Promise<{ editId: string; localTempPath: string }> => {
      const editId = randomUUID()
      const remoteStamp = await this.remoteStamp(sessionId, remotePath, viaSudo)
      const basename = sanitizeEditFilename(remotePath)
      const safeSession = sanitizeSessionSegment(sessionId)
      const tempDir = path.resolve(os.tmpdir(), 'ferry-edit', safeSession, randomUUID())
      const localTempPath = path.resolve(tempDir, basename)
      if (!localTempPath.startsWith(tempDir + path.sep)) {
        logSecurityEvent('edit.path_traversal_blocked', { sessionId, remotePath })
        throw new SshError('VALIDATION', `Unsafe remote filename for edit: ${remotePath}`)
      }
      // Mode is only fully meaningful on POSIX (Windows honors just the
      // read-only attribute bit) — but on a shared Linux/macOS machine with a
      // world-readable /tmp, an unrestricted directory would let other local
      // users read the downloaded remote file's content while it's open.
      await fs.mkdir(tempDir, { recursive: true, mode: 0o700 })

      try {
        await OperationRegistry.getInstance().run(
          { kind: 'edit-download', sessionId, label: `Opening ${basename} for editing`, cancellable: true },
          async (ctx) => {
            if (viaSudo) {
              await downloadForEditSudo(sessionId, remotePath, localTempPath, ctx.signal)
              return
            }
            await downloadForEdit(
              sessionId,
              remotePath,
              localTempPath,
              (bytesTransferred) => {
                ctx.reportProgress(bytesTransferred, undefined, 'bytes')
              },
              ctx.signal
            )
          }
        )

        if (!builtin) {
          const result = await host().openPath(localTempPath)
          if (result) {
            throw new SshError('UNKNOWN', `Could not open "${localTempPath}": ${result}`)
          }
        }

        const stats = await fs.stat(localTempPath)
        const entry: EditEntry = {
          editId,
          sessionId,
          remotePath,
          localTempPath,
          watcher: null,
          debounceTimer: null,
          lastSyncedRevision: localRevision(stats),
          remoteStamp,
          conflictNotified: false,
          sessionClosed: false,
          viaSudo,
          uploading: false,
          pendingReupload: false,
          pendingForce: false
        }
        this.edits.set(editId, entry)
        this.watch(entry)

        this.broadcast({ editId, sessionId, remotePath, localTempPath, state: 'opened', viaSudo })
        return { editId, localTempPath }
      } catch (e) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
        throw e
      }
    })()

    this.pendingOpens.set(dedupKey, openPromise)
    try {
      return await openPromise
    } finally {
      if (this.pendingOpens.get(dedupKey) === openPromise) {
        this.pendingOpens.delete(dedupKey)
      }
    }
  }

  /** Public-safe snapshot of every currently open edit, for hydrating the renderer's Open Edits list on load — the `edit:event` stream alone only covers edits opened after that point. */
  async listEdits(): Promise<OpenEditSnapshot[]> {
    const result: OpenEditSnapshot[] = []
    for (const entry of this.edits.values()) {
      let dirty = false
      try {
        const stats = await fs.stat(entry.localTempPath)
        dirty = localRevision(stats) !== entry.lastSyncedRevision
      } catch {
        // Missing/inaccessible temp file — nothing to sync, treat as not dirty.
      }
      result.push({
        editId: entry.editId,
        sessionId: entry.sessionId,
        remotePath: entry.remotePath,
        localTempPath: entry.localTempPath,
        dirty,
        sessionClosed: entry.sessionClosed,
        viaSudo: entry.viaSudo
      })
    }
    return result
  }

  /** Opens an existing edit session's temp file in the OS default app. */
  async openExternal(editId: string): Promise<void> {
    const entry = this.edits.get(editId)
    if (!entry) {
      throw new SshError('NOT_FOUND', `Edit session ${editId} not found`)
    }
    const result = await host().openPath(entry.localTempPath)
    if (result) {
      throw new SshError('UNKNOWN', `Could not open "${entry.localTempPath}": ${result}`)
    }
  }

  // Watches the containing directory rather than the temp file path itself. Editors that
  // save via write-temp-then-rename-over replace the inode at `localTempPath`, which can
  // cause a watch bound directly to that path to go silent after the first save on some
  // platforms/editors — meaning only the first save would ever re-upload. Each edit gets
  // its own isolated temp directory (see `openRemote`'s `tempDir`, unique per editId), so
  // any event observed in that directory is safe to treat as relevant to this file.
  private watch(entry: EditEntry): void {
    const watchDir = path.dirname(entry.localTempPath)
    const basename = path.basename(entry.localTempPath)
    entry.watcher = watch(watchDir, { persistent: false }, (_eventType, filename) => {
      // `filename` can be null on some platforms — since this directory only ever
      // contains this one temp file, treat any event in it as relevant in that case.
      if (filename !== null && filename !== basename) {
        return
      }
      if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer)
      }
      entry.debounceTimer = setTimeout(() => {
        void this.reupload(entry)
      }, REUPLOAD_DEBOUNCE_MS)
    })
    entry.watcher.on('error', () => {
      entry.watcher?.close()
      entry.watcher = null
    })
  }

  private async remoteStamp(sessionId: string, remotePath: string, viaSudo = false): Promise<{ mtime: number; size: number } | null> {
    const stat = viaSudo ? await statRemoteSudo(sessionId, remotePath) : await statRemoteForEdit(sessionId, remotePath)
    return stat && { mtime: stat.mtime, size: stat.size }
  }

  async forceReupload(editId: string): Promise<void> {
    const entry = this.edits.get(editId)
    if (!entry) {
      throw new SshError('NOT_FOUND', `Edit session ${editId} not found`)
    }
    await this.reupload(entry, true)
  }

  private async reupload(entry: EditEntry, force = false): Promise<void> {
    if (entry.sessionClosed || !this.edits.has(entry.editId)) {
      return
    }
    if (entry.uploading) {
      entry.pendingReupload = true
      entry.pendingForce ||= force
      return
    }
    entry.uploading = true
    try {
      const preUploadStats = await fs.stat(entry.localTempPath).catch(() => null)
      const revision = preUploadStats && localRevision(preUploadStats)
      if (entry.sessionClosed || !this.edits.has(entry.editId)) return
      // An explicit upload may already have handled this pending watch event.
      if (!force && revision === entry.lastSyncedRevision) return
      if (!force && entry.remoteStamp) {
        const current = await this.remoteStamp(entry.sessionId, entry.remotePath, entry.viaSudo)
        if (entry.sessionClosed || !this.edits.has(entry.editId)) {
          return
        }
        if (current && (current.mtime !== entry.remoteStamp.mtime || current.size !== entry.remoteStamp.size)) {
          if (entry.conflictNotified) {
            return
          }
          entry.conflictNotified = true
          this.broadcast({
            editId: entry.editId,
            sessionId: entry.sessionId,
            remotePath: entry.remotePath,
            localTempPath: entry.localTempPath,
            state: 'remote-changed'
          })
          return
        }
      }
      const basename = path.basename(entry.localTempPath)
      this.broadcast({
        editId: entry.editId,
        sessionId: entry.sessionId,
        remotePath: entry.remotePath,
        localTempPath: entry.localTempPath,
        state: 'reuploading'
      })
      try {
        await OperationRegistry.getInstance().run(
          { kind: 'edit-reupload', sessionId: entry.sessionId, label: `Re-uploading ${basename}`, cancellable: false },
          async () => {
            await (entry.viaSudo ? uploadForEditSudo : uploadForEdit)(entry.sessionId, entry.localTempPath, entry.remotePath)
          }
        )
        if (entry.sessionClosed || !this.edits.has(entry.editId)) {
          return
        }
        if (revision !== null) entry.lastSyncedRevision = revision
        entry.remoteStamp = await this.remoteStamp(entry.sessionId, entry.remotePath, entry.viaSudo)
        entry.conflictNotified = false
        this.broadcast({
          editId: entry.editId,
          sessionId: entry.sessionId,
          remotePath: entry.remotePath,
          localTempPath: entry.localTempPath,
          state: 'reuploaded'
        })
      } catch (e) {
        if (!this.edits.has(entry.editId)) {
          return
        }
        // Keep watching — the file and the next save-triggered retry both
        // survive a failed upload (dropped connection, permissions, ...).
        this.broadcast({
          editId: entry.editId,
          sessionId: entry.sessionId,
          remotePath: entry.remotePath,
          localTempPath: entry.localTempPath,
          state: 'upload-error',
          error: e instanceof Error ? e.message : String(e)
        })
      }
    } finally {
      entry.uploading = false
      if (entry.pendingReupload) {
        const nextForce = entry.pendingForce
        entry.pendingReupload = false
        entry.pendingForce = false
        if (!entry.sessionClosed && this.edits.has(entry.editId)) {
          void this.reupload(entry, nextForce)
        }
      }
    }
  }

  /** Stops watching every edit tied to a session — called from SessionManager.close(). Never deletes the temp file: the connection being gone doesn't mean the user is done editing. */
  closeAllForSession(sessionId: string): void {
    for (const entry of this.edits.values()) {
      if (entry.sessionId !== sessionId || entry.sessionClosed) {
        continue
      }
      entry.sessionClosed = true
      entry.watcher?.close()
      entry.watcher = null
      if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer)
        entry.debounceTimer = null
      }
      this.broadcast({
        editId: entry.editId,
        sessionId: entry.sessionId,
        remotePath: entry.remotePath,
        localTempPath: entry.localTempPath,
        state: 'session-closed'
      })
    }
  }

  /**
   * Explicitly closes one edit: stops its watcher/timer, removes it from the registry, and
   * deletes its temp file/directory — unless it has unsynced changes (mtime newer than the last
   * successful upload), in which case the temp file is kept so the edit isn't silently lost.
   * Without this, an edit's map entry/temp directory/watcher previously lived until app quit.
   */
  async closeEdit(editId: string): Promise<void> {
    const entry = this.edits.get(editId)
    if (!entry) {
      return
    }
    entry.watcher?.close()
    entry.watcher = null
    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer)
      entry.debounceTimer = null
    }
    this.edits.delete(editId)
    try {
      const stats = await fs.stat(entry.localTempPath)
      if (localRevision(stats) === entry.lastSyncedRevision) {
        await fs.rm(path.dirname(entry.localTempPath), { recursive: true, force: true })
      }
    } catch {
      // Best-effort — a missing file or locked directory (editor still open) is fine to skip.
    }
    this.broadcast({
      editId: entry.editId,
      sessionId: entry.sessionId,
      remotePath: entry.remotePath,
      localTempPath: entry.localTempPath,
      state: 'closed'
    })
  }

  /**
   * Called on app quit — best-effort cleanup of temp files, but SKIPS
   * deleting any file whose on-disk mtime is newer than the last time it was
   * successfully uploaded (a pending or failed re-upload). Silently deleting
   * an un-synced edit on quit would be data loss; leaving a handful of stray
   * temp files under the OS temp dir is not.
   */
  async disposeAll(): Promise<void> {
    for (const entry of this.edits.values()) {
      entry.watcher?.close()
      if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer)
      }
      try {
        const stats = await fs.stat(entry.localTempPath)
        if (localRevision(stats) !== entry.lastSyncedRevision) {
          continue
        }
        await fs.rm(path.dirname(entry.localTempPath), { recursive: true, force: true })
      } catch {
        // Best-effort — a missing file or locked directory (editor still open) is fine to skip.
      }
    }
    this.edits.clear()
  }
}
