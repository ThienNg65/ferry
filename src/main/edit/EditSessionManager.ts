import { randomUUID } from 'crypto'
import { promises as fs, watch, type FSWatcher } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { BrowserWindow, shell } from 'electron'
import { SessionManager } from '../ssh/SessionManager'
import { OperationRegistry } from '../operations/OperationRegistry'
import { downloadForEdit, uploadForEdit } from '../fs/RemoteFsService'
import { SshError } from '../ssh/errors'
import { EVENT_CHANNELS, type EditEvent } from '../../shared/contract'

/** Debounce window after the last file-change before re-uploading — many editors write-then-rename on save, firing several raw fs events per save. */
const REUPLOAD_DEBOUNCE_MS = 450

interface EditEntry {
  editId: string
  sessionId: string
  remotePath: string
  localTempPath: string
  watcher: FSWatcher | null
  debounceTimer: ReturnType<typeof setTimeout> | null
  /** mtime (ms) of localTempPath as of its last successful upload (or the initial download) — used by disposeAll() to avoid deleting an edit that never made it back to the server. */
  lastSyncedMtimeMs: number
  /** True once the underlying SSH session has closed — the watcher is stopped but the temp file is kept. */
  sessionClosed: boolean
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

  static getInstance(): EditSessionManager {
    if (EditSessionManager.instance === null) {
      EditSessionManager.instance = new EditSessionManager()
    }
    return EditSessionManager.instance
  }

  private broadcast(evt: EditEvent): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(EVENT_CHANNELS.editEvent, evt)
      }
    }
  }

  /** Opens a LOCAL file directly in the OS default app — the local file already is the source of truth, so no temp copy or watcher is needed. */
  async openLocal(localPath: string): Promise<void> {
    const result = await shell.openPath(localPath)
    if (result) {
      throw new SshError('UNKNOWN', `Could not open "${localPath}": ${result}`)
    }
  }

  /** Opens a REMOTE file: downloads it in full to a temp path, opens it in the OS default app, then watches it and re-uploads on every save. */
  async openRemote(sessionId: string, remotePath: string): Promise<{ editId: string }> {
    const existing = [...this.edits.values()].find((e) => e.sessionId === sessionId && e.remotePath === remotePath)
    if (existing) {
      const result = await shell.openPath(existing.localTempPath)
      if (result) {
        throw new SshError('UNKNOWN', `Could not open "${existing.localTempPath}": ${result}`)
      }
      return { editId: existing.editId }
    }

    const editId = randomUUID()
    const basename = remotePath.split('/').filter(Boolean).pop() ?? 'file'
    const tempDir = path.join(os.tmpdir(), 'ferry-edit', sessionId, randomUUID())
    const localTempPath = path.join(tempDir, basename)
    // Mode is only fully meaningful on POSIX (Windows honors just the
    // read-only attribute bit) — but on a shared Linux/macOS machine with a
    // world-readable /tmp, an unrestricted directory would let other local
    // users read the downloaded remote file's content while it's open.
    await fs.mkdir(tempDir, { recursive: true, mode: 0o700 })

    await OperationRegistry.getInstance().run(
      { kind: 'edit-download', sessionId, label: `Opening ${basename} for editing`, cancellable: true },
      async (ctx) => {
        await downloadForEdit(sessionId, remotePath, localTempPath, (bytesTransferred) => {
          ctx.reportProgress(bytesTransferred, undefined, 'bytes')
        })
      }
    )

    const result = await shell.openPath(localTempPath)
    if (result) {
      throw new SshError('UNKNOWN', `Could not open "${localTempPath}": ${result}`)
    }

    const stats = await fs.stat(localTempPath)
    const entry: EditEntry = {
      editId,
      sessionId,
      remotePath,
      localTempPath,
      watcher: null,
      debounceTimer: null,
      lastSyncedMtimeMs: stats.mtimeMs,
      sessionClosed: false
    }
    this.edits.set(editId, entry)
    this.watch(entry)

    this.broadcast({ editId, sessionId, remotePath, localTempPath, state: 'opened' })
    return { editId }
  }

  private watch(entry: EditEntry): void {
    entry.watcher = watch(entry.localTempPath, { persistent: false }, () => {
      if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer)
      }
      entry.debounceTimer = setTimeout(() => {
        void this.reupload(entry)
      }, REUPLOAD_DEBOUNCE_MS)
    })
  }

  private async reupload(entry: EditEntry): Promise<void> {
    if (entry.sessionClosed) {
      return
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
          await uploadForEdit(entry.sessionId, entry.localTempPath, entry.remotePath)
        }
      )
      const stats = await fs.stat(entry.localTempPath)
      entry.lastSyncedMtimeMs = stats.mtimeMs
      this.broadcast({
        editId: entry.editId,
        sessionId: entry.sessionId,
        remotePath: entry.remotePath,
        localTempPath: entry.localTempPath,
        state: 'reuploaded'
      })
    } catch (e) {
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
        if (stats.mtimeMs > entry.lastSyncedMtimeMs) {
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
