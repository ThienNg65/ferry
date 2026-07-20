import * as path from 'path'
import { SessionManager } from '../ssh/SessionManager'
import { SshError } from '../ssh/errors'
import { listRecursive, mkdirRecursive as mkdirLocalRecursive, remove as removeLocal } from '../fs/LocalFsService'
import { TransferQueue } from '../transfer/TransferQueue'
import type { SyncOptions, SyncPlan, SyncRunResult } from '../../shared/contract'

/**
 * A file/dir entry from either side's recursive tree walk — the shape
 * `LocalFsService.listRecursive` and `RemoteShell.readdirRecursive` both
 * already return, kept generic here since the diff itself doesn't care which
 * physical side is source vs. destination (the caller resolves that from
 * `direction`).
 */
export interface TreeItem {
  relPath: string
  isDir: boolean
  size: number
  mtimeMs?: number
}

/**
 * Local mtime is ms-precision; SFTP mtime is whole-second, server-clock —
 * exact-equality diffing would misfire (spurious re-transfers every run, or
 * missed real changes). A file only counts as changed if its size differs,
 * or the source is newer than the destination by more than this tolerance —
 * never the reverse, so a destination that happens to be clock-skewed ahead
 * is never mistaken for "already up to date" and never overwritten by an
 * older source either.
 */
const MTIME_TOLERANCE_MS = 2000

/**
 * Diffs a source tree against a destination tree. Pure and synchronous so
 * it's unit-testable without touching disk or a real SSH connection — see
 * SyncService.test.ts.
 */
export function computePlan(sourceTree: TreeItem[], destTree: TreeItem[], deleteExtras: boolean): SyncPlan {
  const destFiles = new Map(destTree.filter((e) => !e.isDir).map((e) => [e.relPath, e]))
  const toTransfer: SyncPlan['toTransfer'] = []
  let totalBytes = 0

  for (const src of sourceTree) {
    if (src.isDir) {
      continue
    }
    const dest = destFiles.get(src.relPath)
    const changed =
      !dest ||
      dest.size !== src.size ||
      (src.mtimeMs !== undefined && dest.mtimeMs !== undefined && src.mtimeMs - dest.mtimeMs > MTIME_TOLERANCE_MS)
    if (changed) {
      toTransfer.push({ relPath: src.relPath, size: src.size })
      totalBytes += src.size
    }
  }

  const toDelete: string[] = []
  if (deleteExtras) {
    const sourceTopLevelNames = new Set(sourceTree.map((e) => e.relPath.split('/')[0]))
    for (const dest of destTree) {
      const topLevelName = dest.relPath.split('/')[0]
      // Only the top-level entry itself, never its descendants — deleting a
      // top-level extra directory already removes everything under it.
      if (dest.relPath === topLevelName && !sourceTopLevelNames.has(topLevelName)) {
        toDelete.push(dest.relPath)
      }
    }
  }

  return { toTransfer, toDelete, totalBytes }
}

/**
 * Defense in depth against a malicious/compromised remote server supplying a `relPath` that
 * resolves outside `root` — most severe for the delete-extras path, which turns a `toDelete`
 * entry straight into a local `removeLocal` call. The primary guard is
 * `RemoteShell.readdirRecursive`, which already rejects unsafe entry names.
 */
function joinLocal(root: string, relPath: string): string {
  const resolvedRoot = path.resolve(root)
  const joined = path.resolve(root, ...relPath.split('/'))
  // `path.resolve` of a drive/filesystem root (e.g. "C:\" or "/") already ends in a separator —
  // appending another would make the prefix check below reject every legitimate path under it.
  const boundary = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep
  if (joined !== resolvedRoot && !joined.startsWith(boundary)) {
    throw new SshError('SFTP', `Refusing to resolve unsafe relative path "${relPath}" outside "${root}"`)
  }
  return path.join(root, ...relPath.split('/'))
}

function joinRemote(root: string, relPath: string): string {
  return `${root.replace(/\/$/, '')}/${relPath}`
}

async function listLocalTreeOrEmpty(dirPath: string): Promise<TreeItem[]> {
  try {
    return await listRecursive(dirPath)
  } catch (e) {
    if (e instanceof SshError && e.code === 'NOT_FOUND') {
      return []
    }
    throw e
  }
}

async function listRemoteTreeOrEmpty(sessionId: string, dirPath: string): Promise<TreeItem[]> {
  try {
    return await SessionManager.getInstance().shell(sessionId).readdirRecursive(dirPath)
  } catch {
    return []
  }
}

/**
 * Loads both sides' trees, resolved per `direction`. The DESTINATION side
 * tolerates not existing yet (first-ever sync into a fresh directory is a
 * normal case, not an error) — the SOURCE side does not, since there's
 * nothing to sync from.
 */
async function loadTrees(options: SyncOptions): Promise<{ sourceTree: TreeItem[]; destTree: TreeItem[] }> {
  const isPush = options.direction === 'push'
  const localTree = isPush
    ? await listRecursive(options.localPath)
    : await listLocalTreeOrEmpty(options.localPath)
  const remoteTree = isPush
    ? await listRemoteTreeOrEmpty(options.sessionId, options.remotePath)
    : await SessionManager.getInstance().shell(options.sessionId).readdirRecursive(options.remotePath)
  return isPush ? { sourceTree: localTree, destTree: remoteTree } : { sourceTree: remoteTree, destTree: localTree }
}

/** Read-only preview of what a sync run would do — no writes, no deletes. */
export async function previewSync(options: SyncOptions): Promise<SyncPlan> {
  const { sourceTree, destTree } = await loadTrees(options)
  return computePlan(sourceTree, destTree, options.deleteExtras)
}

/**
 * Executes a sync: creates missing destination directories, optionally
 * deletes destination-only top-level extras, then hands each changed file to
 * the existing TransferQueue (fire-and-forget — this operation completes
 * once files are queued, not once they finish; progress continues in the
 * Transfers dock exactly like a multi-select upload). Recomputes the diff
 * fresh rather than trusting a client-supplied plan, to avoid a stale-plan
 * race if the user took a while reviewing the preview dialog.
 *
 * Cancellation is partial by design, consistent with this codebase's existing
 * OperationRegistry philosophy: aborting stops the mkdir/delete/enqueue loop,
 * but any file already handed to TransferQueue keeps running — cancel it
 * individually from the Transfers dock. Also inherits a pre-existing gap this
 * feature didn't introduce: `SessionManager.close()` doesn't cancel in-flight
 * TransferQueue jobs for that session, so disconnecting mid-sync can leave
 * orphaned queued transfers — a candidate follow-up, not fixed here.
 */
export async function runSync(
  options: SyncOptions,
  ctx: { signal: AbortSignal; reportProgress: (current: number, total?: number, unit?: 'items') => void }
): Promise<SyncRunResult> {
  const isPush = options.direction === 'push'
  const shell = SessionManager.getInstance().shell(options.sessionId)
  const { sourceTree, destTree } = await loadTrees(options)
  const plan = computePlan(sourceTree, destTree, options.deleteExtras)

  if (isPush) {
    await shell.mkdirRecursive(options.remotePath)
  } else {
    await mkdirLocalRecursive(options.localPath)
  }

  for (const dir of sourceTree.filter((e) => e.isDir)) {
    if (ctx.signal.aborted) {
      throw new SshError('CANCELLED', 'Sync cancelled')
    }
    if (isPush) {
      await shell.mkdirRecursive(joinRemote(options.remotePath, dir.relPath))
    } else {
      await mkdirLocalRecursive(joinLocal(options.localPath, dir.relPath))
    }
  }

  let deletedCount = 0
  const destByRelPath = new Map(destTree.map((e) => [e.relPath, e]))
  for (const relPath of plan.toDelete) {
    if (ctx.signal.aborted) {
      throw new SshError('CANCELLED', 'Sync cancelled')
    }
    if (isPush) {
      await shell.deleteRecursive(joinRemote(options.remotePath, relPath))
    } else {
      const destEntry = destByRelPath.get(relPath)
      await removeLocal(joinLocal(options.localPath, relPath), destEntry?.isDir ?? false)
    }
    deletedCount++
  }

  const queuedTransferIds: string[] = []
  for (const [index, item] of plan.toTransfer.entries()) {
    if (ctx.signal.aborted) {
      throw new SshError('CANCELLED', 'Sync cancelled')
    }
    const localFull = joinLocal(options.localPath, item.relPath)
    const remoteFull = joinRemote(options.remotePath, item.relPath)
    const transferId = TransferQueue.getInstance().enqueue(
      options.sessionId,
      isPush ? 'upload' : 'download',
      localFull,
      remoteFull
    )
    queuedTransferIds.push(transferId)
    ctx.reportProgress(index + 1, plan.toTransfer.length, 'items')
  }

  return { queuedTransferIds, deletedCount }
}
