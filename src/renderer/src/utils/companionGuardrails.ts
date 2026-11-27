export interface RemoteDiskSnapshot {
  totalBytes: number
  usedBytes: number
  availableBytes: number
  mountPoint?: string
  inodesTotal?: number
  inodesUsed?: number
  inodesAvailable?: number
}

const SAFE_ENV_TEMPLATE_RE = /^\.env\.(?:example|sample|template|dist)$/i
const SAFE_PUBLIC_KEY_RE = /(?:^|[_-])id_(?:rsa|ed25519|ecdsa|dsa)\.pub$/i
const SENSITIVE_BASENAME_RE =
  /^(?:\.env(?:\..+)?|(?:.*[_-])?id_(?:rsa|ed25519|ecdsa|dsa)|\.npmrc|\.pypirc|\.netrc|kubeconfig|credentials\.json|service[-_]?account.*\.json|.*secret.*)$/i
const SENSITIVE_EXT_RE = /\.(?:pem|key|ppk|ovpn|p12|pfx|kdbx|jks|keystore)$/i

function formatCompactBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let val = bytes
  let idx = 0
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024
    idx += 1
  }
  return `${val >= 10 || idx === 0 ? Math.round(val) : val.toFixed(1)} ${units[idx]}`
}

export function isSensitiveSecretFilename(nameOrPath: string): boolean {
  const base = (nameOrPath.split(/[\\/]/).pop() || nameOrPath).trim()
  if (!base || SAFE_ENV_TEMPLATE_RE.test(base) || SAFE_PUBLIC_KEY_RE.test(base)) return false
  return SENSITIVE_BASENAME_RE.test(base) || SENSITIVE_EXT_RE.test(base)
}

function checkRemoteDiskRisk(incomingBytes: number, remoteDisk?: RemoteDiskSnapshot | null): string | null {
  if (!remoteDisk || remoteDisk.totalBytes <= 0) return null
  const mount = remoteDisk.mountPoint || '/'
  const usedPct = Math.round((remoteDisk.usedBytes / remoteDisk.totalBytes) * 100)
  if (incomingBytes > 0 && incomingBytes > remoteDisk.availableBytes) {
    return `Upload requires ${formatCompactBytes(incomingBytes)}, but the remote filesystem (${mount}) only reports ${formatCompactBytes(remoteDisk.availableBytes)} free (${usedPct}% full).`
  }
  if (usedPct >= 95) {
    return `Remote filesystem (${mount}) is ${usedPct}% full (${formatCompactBytes(remoteDisk.availableBytes)} free).`
  }
  if (remoteDisk.inodesTotal && remoteDisk.inodesTotal > 0 && remoteDisk.inodesUsed !== undefined) {
    const inodePct = Math.round((remoteDisk.inodesUsed / remoteDisk.inodesTotal) * 100)
    if (inodePct >= 95) {
      return `Remote filesystem (${mount}) inode usage is ${inodePct}% (${remoteDisk.inodesAvailable ?? 0} free inodes).`
    }
  }
  return null
}

export interface TransferPreFlightResult {
  warnings: string[]
  sensitiveFiles: string[]
  lowDiskWarning: string | null
}

export function evaluateTransferPreFlight(
  intents: ReadonlyArray<{ direction: 'upload' | 'download'; targetName: string; sourceSize: number | null; isDir?: boolean }>,
  remoteDisk?: RemoteDiskSnapshot | null,
  nestedUploadScan?: { relativePaths: readonly string[]; totalBytes: number; truncated?: boolean } | null
): TransferPreFlightResult {
  const uploads = intents.filter((i) => i.direction === 'upload')
  if (uploads.length === 0) {
    return { warnings: [], sensitiveFiles: [], lowDiskWarning: null }
  }

  const seenSensitive = new Set<string>()
  const sensitiveFiles: string[] = []
  const recordIfSensitive = (nameOrPath: string): void => {
    if (isSensitiveSecretFilename(nameOrPath) && !seenSensitive.has(nameOrPath)) {
      seenSensitive.add(nameOrPath)
      sensitiveFiles.push(nameOrPath)
    }
  }
  for (const u of uploads) {
    recordIfSensitive(u.targetName)
  }
  if (nestedUploadScan?.relativePaths) {
    for (const rel of nestedUploadScan.relativePaths) {
      recordIfSensitive(rel)
    }
  }

  const fileUploadBytes = uploads.reduce(
    (sum, u) => sum + (!u.isDir && u.sourceSize && u.sourceSize > 0 ? u.sourceSize : 0),
    0
  )
  const knownUploadBytes = fileUploadBytes + (nestedUploadScan && nestedUploadScan.totalBytes > 0 ? nestedUploadScan.totalBytes : 0)
  const lowDiskWarning = checkRemoteDiskRisk(knownUploadBytes, remoteDisk)

  const warnings: string[] = []
  if (sensitiveFiles.length > 0) {
    const listed = sensitiveFiles.slice(0, 3).join(', ')
    const extra = sensitiveFiles.length > 3 ? ` (+${sensitiveFiles.length - 3} more)` : ''
    warnings.push(
      `Sensitive credential/secret file detected for upload: ${listed}${extra}. Confirm this server should receive secrets.`
    )
  }
  if (lowDiskWarning) {
    warnings.push(lowDiskWarning)
  }
  if (nestedUploadScan?.truncated) {
    warnings.push(
      'Folder pre-flight scan hit its safety limit and could not inspect every nested file. Some secrets or total upload size may not be reflected above.'
    )
  }

  return { warnings, sensitiveFiles, lowDiskWarning }
}

export interface SyncPreFlightResult {
  warnings: string[]
  hasDestructiveDeletes: boolean
  sensitiveFiles: string[]
  lowDiskWarning: string | null
}

export function evaluateSyncPreFlight(
  plan: { toTransfer: ReadonlyArray<{ relPath: string }>; toDelete: readonly string[]; totalBytes: number },
  options: { direction: 'push' | 'pull'; deleteExtras?: boolean },
  remoteDisk?: RemoteDiskSnapshot | null
): SyncPreFlightResult {
  const warnings: string[] = []
  const hasDestructiveDeletes = Boolean(options.deleteExtras && plan.toDelete.length > 0)
  if (hasDestructiveDeletes) {
    warnings.push(
      `Mirror mode will permanently delete ${plan.toDelete.length} destination item(s) not present in the source.`
    )
  }

  const sensitiveFiles =
    options.direction === 'push'
      ? plan.toTransfer.map((t) => t.relPath).filter((p) => isSensitiveSecretFilename(p))
      : []

  if (sensitiveFiles.length > 0) {
    const listed = sensitiveFiles.slice(0, 3).join(', ')
    const extra = sensitiveFiles.length > 3 ? ` (+${sensitiveFiles.length - 3} more)` : ''
    warnings.push(`Push plan includes sensitive file(s): ${listed}${extra}.`)
  }

  const lowDiskWarning =
    options.direction === 'push' ? checkRemoteDiskRisk(plan.totalBytes, remoteDisk) : null
  if (lowDiskWarning) {
    warnings.push(lowDiskWarning)
  }

  return { warnings, hasDestructiveDeletes, sensitiveFiles, lowDiskWarning }
}
