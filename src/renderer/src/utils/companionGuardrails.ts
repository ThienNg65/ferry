export interface RemoteDiskSnapshot {
  totalBytes: number
  usedBytes: number
  availableBytes: number
}

const SAFE_ENV_TEMPLATE_RE = /^\.env\.(?:example|sample|template|dist)$/i
const SENSITIVE_BASENAME_RE =
  /^(?:\.env(?:\..+)?|id_rsa|id_ed25519|id_ecdsa|id_dsa|\.npmrc|\.pypirc|\.netrc|kubeconfig|credentials\.json|service[-_]?account.*\.json)$/i
const SENSITIVE_EXT_RE = /\.(?:pem|key|p12|pfx|kdbx|jks|keystore)$/i

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
  if (!base || SAFE_ENV_TEMPLATE_RE.test(base)) return false
  return SENSITIVE_BASENAME_RE.test(base) || SENSITIVE_EXT_RE.test(base)
}

function checkRemoteDiskRisk(incomingBytes: number, remoteDisk?: RemoteDiskSnapshot | null): string | null {
  if (!remoteDisk || remoteDisk.totalBytes <= 0) return null
  const usedPct = Math.round((remoteDisk.usedBytes / remoteDisk.totalBytes) * 100)
  if (incomingBytes > 0 && incomingBytes > remoteDisk.availableBytes) {
    return `Upload requires ${formatCompactBytes(incomingBytes)}, but the remote filesystem only reports ${formatCompactBytes(remoteDisk.availableBytes)} free (${usedPct}% full).`
  }
  if (usedPct >= 95) {
    return `Remote root filesystem is ${usedPct}% full (${formatCompactBytes(remoteDisk.availableBytes)} free).`
  }
  return null
}

export interface TransferPreFlightResult {
  warnings: string[]
  sensitiveFiles: string[]
  lowDiskWarning: string | null
}

export function evaluateTransferPreFlight(
  intents: ReadonlyArray<{ direction: 'upload' | 'download'; targetName: string; sourceSize: number | null }>,
  remoteDisk?: RemoteDiskSnapshot | null
): TransferPreFlightResult {
  const uploads = intents.filter((i) => i.direction === 'upload')
  if (uploads.length === 0) {
    return { warnings: [], sensitiveFiles: [], lowDiskWarning: null }
  }

  const sensitiveFiles = uploads
    .map((u) => u.targetName)
    .filter((name) => isSensitiveSecretFilename(name))

  const knownUploadBytes = uploads.reduce((sum, u) => sum + (u.sourceSize && u.sourceSize > 0 ? u.sourceSize : 0), 0)
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
