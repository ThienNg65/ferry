import * as path from 'path'
import { rmdir as rmdirLocal } from 'fs/promises'
import { SessionManager } from '../ssh/SessionManager'
import { SshError } from '../ssh/errors'
import { listRecursive, mkdirRecursive as mkdirLocalRecursive, remove as removeLocal } from '../fs/LocalFsService'
import { TransferQueue } from '../transfer/TransferQueue'
import type { CompareRequest, CompareRow, CompareStatus, SyncOptions, SyncPlan, SyncRunResult } from '../../shared/contract'

/**
 * An entry from either side's recursive tree walk — the shape
 * `LocalFsService.listRecursive` and `RemoteShell.readdirRecursive` both
 * already return, kept generic here since the diff itself doesn't care which
 * physical side is source vs. destination (the caller resolves that from
 * `direction`).
 */
export interface TreeItem {
  relPath: string
  isDir: boolean
  isSymlink?: true
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
  const destFiles = new Map(destTree.filter((e) => !e.isDir && !e.isSymlink).map((e) => [e.relPath, e]))
  const toTransfer: SyncPlan['toTransfer'] = []
  let totalBytes = 0

  for (const src of sourceTree) {
    if (src.isDir || src.isSymlink) {
      continue
    }
    const dest = destFiles.get(src.relPath)
    const changed =
      !dest ||
      dest.size !== src.size ||
      (src.mtimeMs !== undefined && dest.mtimeMs !== undefined && src.mtimeMs - dest.mtimeMs > MTIME_TOLERANCE_MS)
    if (changed) {
      toTransfer.push({ relPath: src.relPath, size: src.size, action: dest ? 'overwrite' : 'new' })
      totalBytes += src.size
    }
  }

  const toDelete: string[] = []
  if (deleteExtras) {
    const sourceTopLevelNames = new Set(sourceTree.map((e) => e.relPath.split('/')[0]))
    for (const dest of destTree) {
      const topLevelName = dest.relPath.split('/')[0]
      // Entries under a shared top-level name are outside mirror's deletion scope.
      if (!sourceTopLevelNames.has(topLevelName)) {
        toDelete.push(dest.relPath)
      }
    }
  }

  return { toTransfer, toDelete, totalBytes }
}

export function computeDiff(localTree: TreeItem[], remoteTree: TreeItem[]): CompareRow[] {
  const local = new Map(localTree.filter((e) => !e.isDir).map((e) => [e.relPath, e]))
  const remote = new Map(remoteTree.filter((e) => !e.isDir).map((e) => [e.relPath, e]))
  const rows: CompareRow[] = []
  for (const relPath of new Set([...local.keys(), ...remote.keys()])) {
    const l = local.get(relPath)
    const r = remote.get(relPath)
    let status: CompareStatus
    if (!r) {
      status = 'localOnly'
    } else if (!l) {
      status = 'remoteOnly'
    } else {
      const delta = l.mtimeMs !== undefined && r.mtimeMs !== undefined ? l.mtimeMs - r.mtimeMs : 0
      if (delta > MTIME_TOLERANCE_MS) {
        status = 'localNewer'
      } else if (delta < -MTIME_TOLERANCE_MS) {
        status = 'remoteNewer'
      } else {
        status = l.size === r.size ? 'same' : 'sizeDiff'
      }
    }
    rows.push({ relPath, status, localSize: l?.size, remoteSize: r?.size, localMtimeMs: l?.mtimeMs, remoteMtimeMs: r?.mtimeMs })
  }
  return rows.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

export async function compareTrees(req: CompareRequest): Promise<CompareRow[]> {
  const [localTree, remoteTree] = await Promise.all([
    listLocalTreeOrEmpty(req.localPath),
    listRemoteTreeOrEmpty(req.sessionId, req.remotePath)
  ])
  return computeDiff(localTree, remoteTree)
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
  if (joined === resolvedRoot || !joined.startsWith(boundary)) {
    throw new SshError('SFTP', `Refusing to resolve unsafe relative path "${relPath}" outside "${root}"`)
  }
  return path.join(root, ...relPath.split('/'))
}

function joinRemote(root: string, relPath: string): string {
  return `${root.replace(/\/$/, '')}/${relPath}`
}

async function listLocalTreeOrEmpty(dirPath: string, includeSymlinks = false): Promise<TreeItem[]> {
  try {
    return await listRecursive(dirPath, includeSymlinks)
  } catch (e) {
    if (e instanceof SshError && e.code === 'NOT_FOUND') {
      return []
    }
    throw e
  }
}

async function listRemoteTreeOrEmpty(sessionId: string, dirPath: string, includeSymlinks = false): Promise<TreeItem[]> {
  try {
    return await SessionManager.getInstance().shell(sessionId).readdirRecursive(dirPath, includeSymlinks)
  } catch (e) {
    if (e instanceof SshError && e.code === 'NOT_FOUND') {
      return []
    }
    throw e
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
  // Mirror compares names on both sides, but symlinks are never transfer candidates.
  const includeSymlinks = options.deleteExtras
  const localTree = isPush
    ? await listRecursive(options.localPath, includeSymlinks)
    : await listLocalTreeOrEmpty(options.localPath, includeSymlinks)
  const remoteTree = isPush
    ? await listRemoteTreeOrEmpty(options.sessionId, options.remotePath, includeSymlinks)
    : await SessionManager.getInstance().shell(options.sessionId).readdirRecursive(options.remotePath, includeSymlinks)
  return isPush ? { sourceTree: localTree, destTree: remoteTree } : { sourceTree: remoteTree, destTree: localTree }
}

/** Read-only preview of what a sync run would do — no writes, no deletes. */
export async function previewSync(options: SyncOptions): Promise<SyncPlan> {
  const { sourceTree, destTree } = await loadTrees(options)
  return computePlan(sourceTree, destTree, options.deleteExtras)
}

function matchesApproval(plan: SyncPlan, approved: SyncPlan): boolean {
  const transfers = new Map(approved.toTransfer.map(({ relPath, size }) => [relPath, size]))
  const deletions = new Set(approved.toDelete)
  return transfers.size === plan.toTransfer.length && deletions.size === plan.toDelete.length
    && plan.toTransfer.every(({ relPath, size }) => transfers.get(relPath) === size)
    && plan.toDelete.every((relPath) => deletions.has(relPath))
}

export function summarizeSync({ queuedTransferIds, deletedCount }: SyncRunResult): string {
  return `${deletedCount} destination item(s) deleted. ${queuedTransferIds.length} transfer(s) queued. Check Transfers for file progress.`
}

/** Revalidates approval before making changes, then queues transfers without waiting for them. */
export async function runSync(
  options: SyncOptions,
  approvedPlan: SyncPlan,
  ctx: { signal: AbortSignal; reportProgress: (current: number, total?: number, unit?: 'items') => void }
): Promise<SyncRunResult> {
  const isPush = options.direction === 'push'
  const result: SyncRunResult = { queuedTransferIds: [], deletedCount: 0 }
  const deletedPaths: string[] = []
  const queuedPaths: string[] = []
  const checkCancellation = (): void => {
    if (ctx.signal.aborted) throw new SshError('CANCELLED', 'Sync cancelled.')
  }

  try {
    checkCancellation()
    const shell = SessionManager.getInstance().shell(options.sessionId)
    const { sourceTree, destTree } = await loadTrees(options)
    checkCancellation()
    const plan = computePlan(sourceTree, destTree, options.deleteExtras)
    if (!matchesApproval(plan, approvedPlan)) {
      throw new SshError('VALIDATION', 'The folders changed. Preview again and review the updated plan.')
    }

    if (isPush) await shell.mkdirRecursive(options.remotePath)
    else await mkdirLocalRecursive(options.localPath)

    for (const dir of sourceTree.filter((e) => e.isDir)) {
      checkCancellation()
      if (isPush) await shell.mkdirRecursive(joinRemote(options.remotePath, dir.relPath))
      else await mkdirLocalRecursive(joinLocal(options.localPath, dir.relPath))
    }

    const approvedPaths = new Set(plan.toDelete)
    // Delete the reviewed children before their parents. An unreviewed entry that
    // arrives under a directory leaves it nonempty and makes rmdir fail safely.
    const deletions = destTree.filter((item) => approvedPaths.has(item.relPath)).reverse()
    const total = deletions.length + plan.toTransfer.length
    for (const item of deletions) {
      checkCancellation()
      const target = isPush
        ? joinRemote(options.remotePath, item.relPath)
        : joinLocal(options.localPath, item.relPath)
      try {
        if (isPush) {
          if (item.isDir) await shell.rmdir(target)
          else await shell.unlink(target)
        } else if (item.isDir) {
          await rmdirLocal(target)
        } else {
          await removeLocal(target, false)
        }
      } catch (e) {
        throw new Error(`Could not confirm deletion of "${target}": ${e instanceof Error ? e.message : String(e)}`)
      }
      deletedPaths.push(target)
      result.deletedCount++
      ctx.reportProgress(result.deletedCount, total, 'items')
    }

    for (const item of plan.toTransfer) {
      checkCancellation()
      const localFile = joinLocal(options.localPath, item.relPath)
      const remoteFile = joinRemote(options.remotePath, item.relPath)
      const transferId = TransferQueue.getInstance().enqueue(
        options.sessionId, isPush ? 'upload' : 'download', localFile, remoteFile
      )
      queuedPaths.push(isPush ? remoteFile : localFile)
      result.queuedTransferIds.push(transferId)
      ctx.reportProgress(result.deletedCount + result.queuedTransferIds.length, total, 'items')
    }
    return result
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const code = ctx.signal.aborted ? 'CANCELLED' : e instanceof SshError ? e.code : 'UNKNOWN'
    const outcome = [`${message} ${summarizeSync(result)}`]
    if (deletedPaths.length) outcome.push('\nConfirmed deletions', deletedPaths.join('\n'))
    if (queuedPaths.length) outcome.push('\nQueued destinations', queuedPaths.join('\n'))
    throw new SshError(code, outcome.join('\n'))
  }
}
