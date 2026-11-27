/**
 * Shared IPC contract — the single source of truth for every channel name,
 * request/response envelope, and push-event payload exchanged between the
 * Node.js sidecar and the renderer.
 *
 * Both the renderer bridge (`src/renderer/src/bridge/neutralinoApi.ts`) and
 * the sidecar IPC handlers import the channel lists from here, so the two
 * can never silently drift: adding a channel in one place without the other
 * becomes a type error.
 *
 * Design rules:
 *  - Every `invoke` resolves to an {@link IpcResult} envelope, never a raw value.
 *  - Push events (sidecar → renderer) carry typed payloads keyed by channel.
 *  - No runtime dependencies on Node here — this module is imported by the
 *    renderer too.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Result envelope
// ─────────────────────────────────────────────────────────────────────────────

/** Stable, machine-readable error codes surfaced across the IPC boundary. */
export type IpcErrorCode =
  | 'UNKNOWN'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'VALIDATION'
  | 'SSH_CONNECT'
  | 'SSH_TIMEOUT'
  | 'SSH_EXEC'
  | 'SFTP'
  | 'CANCELLED'
  | 'ARCHIVE_TOOL_NOT_FOUND'
  | 'AUTH'
  | 'HOST_KEY_MISMATCH'
  | 'PROXY_CONNECT'

/** Successful response wrapper. */
export interface IpcOk<T> {
  ok: true
  data: T
}

/** Failed response wrapper. Carries a stable code plus a human message. */
export interface IpcErr {
  ok: false
  code: IpcErrorCode
  message: string
  /** Set only for `HOST_KEY_MISMATCH` — identifies exactly which hop/target mismatched, so a
   * user-confirmed retry can scope its trust override to that host:port alone instead of every
   * hop in the connection. */
  hostKey?: { host: string; port: number }
}

/** Discriminated union returned by every `invoke` channel. */
export type IpcResult<T> = IpcOk<T> | IpcErr

/** Convenience constructor for a success envelope. */
export function ok<T>(data: T): IpcOk<T> {
  return { ok: true, data }
}

/** Convenience constructor for an error envelope. */
export function err(code: IpcErrorCode, message: string, hostKey?: { host: string; port: number }): IpcErr {
  return { ok: false, code, message, hostKey }
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — sites / auth
// ─────────────────────────────────────────────────────────────────────────────

/** Supported authentication methods. `agent` delegates to a running ssh-agent/Pageant/Windows OpenSSH Agent — no secret stored by Ferry at all. */
export type AuthMethod = 'password' | 'privateKey' | 'agent'

/** Proxy protocol used to reach the first hop (or the target, if there's no jump-host chain) — distinct from jump-host tunneling, for a user behind a corporate proxy with no bastion host. */
export type ProxyType = 'socks5' | 'http'

export interface ProxyConfig {
  type: ProxyType
  host: string
  port: number
  username?: string
  password?: string
}

/** {@link ProxyConfig} as returned to the renderer — a boolean instead of a decrypted password, mirroring {@link JumpHostInfo}. */
export interface ProxyInfo {
  type: ProxyType
  host: string
  port: number
  username?: string
  hasPassword: boolean
}

/**
 * One hop in a jump-host (bastion) chain — the SSH connection tunnels
 * through each hop in order before reaching the real target. A site's
 * `jumpHosts` array is ordered: hop 0 is reached directly, each subsequent
 * hop is reached by tunneling through the previous one, and the target is
 * reached by tunneling through the last hop. Only password/private-key auth
 * are supported for a hop itself (not agent) — a deliberate scope limit, not
 * an oversight.
 */
export interface JumpHostConfig {
  host: string
  port: number
  username: string
  authMethod: 'password' | 'privateKey'
  privateKeyPath?: string
  password?: string
  passphrase?: string
  /** Original 0-based index from the loaded Site.jumpHosts array so reordering preserves saved encrypted secrets. */
  sourceIndex?: number
}

/** {@link JumpHostConfig} as returned to the renderer — booleans instead of decrypted secrets, mirroring {@link Site}. */
export interface JumpHostInfo {
  host: string
  port: number
  username: string
  authMethod: 'password' | 'privateKey'
  privateKeyPath?: string
  hasPassword: boolean
  hasPassphrase: boolean
}

export type SiteEnvironment = 'prod' | 'staging' | 'dev'

/**
 * A saved connection profile. Never carries decrypted secrets — only booleans
 * indicating whether a secret is set, so the renderer can render form state
 * without ever seeing plaintext credentials.
 */
export interface Site {
  id: string
  name: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  /** Path to a private key file on disk (privateKey auth only). */
  privateKeyPath?: string
  /** Overrides the platform-default ssh-agent socket/pipe path (agent auth only) — e.g. a custom `SSH_AUTH_SOCK`, or the literal `pageant`. */
  agentPath?: string
  remoteInitialPath?: string
  localInitialPath?: string
  hasPassword: boolean
  hasPassphrase: boolean
  /** Ordered jump-host chain (hop 0 first) — absent/empty means a direct connection. */
  jumpHosts?: JumpHostInfo[]
  /** 'inherit' (default, absent means this) uses the app-wide default proxy if one is set; 'none' forces a direct connection even if a default is set; 'custom' uses this site's own `proxy`. */
  proxyMode?: 'inherit' | 'none' | 'custom'
  /** Present only when `proxyMode === 'custom'`. */
  proxy?: ProxyInfo
  /** Free-text group/folder name for organizing the site list — undefined means ungrouped. */
  group?: string
  environment?: SiteEnvironment
  createdAt: string
  updatedAt: string
}

/** Payload for creating/updating a site — secrets are plaintext in-flight only, never stored as-is. */
export interface SiteInput {
  name: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  privateKeyPath?: string
  agentPath?: string
  remoteInitialPath?: string
  localInitialPath?: string
  password?: string
  passphrase?: string
  /** Ordered jump-host chain (hop 0 first) — absent/empty means a direct connection. */
  jumpHosts?: JumpHostConfig[]
  proxyMode?: 'inherit' | 'none' | 'custom'
  proxy?: ProxyConfig
  group?: string
  environment?: SiteEnvironment
}

/** An ad-hoc (not saved) connection profile used for quick-connect. */
export interface QuickConnectInput extends SiteInput {}

/** Request to generate a new ed25519 SSH keypair and write it to disk. */
export interface KeyGenerateRequest {
  /** Full path to write the private key to (the public key is written alongside as `<path>.pub`). */
  keyPath: string
  /** Left unset (or empty) for no passphrase — only honored when a system `ssh-keygen` is available, see `KeyGenerateResult.method`. */
  passphrase?: string
  /** Written into the public key's trailing comment field, e.g. a slugified site name. */
  comment?: string
}

/** Result of generating a new SSH keypair. */
export interface KeyGenerateResult {
  privateKeyPath: string
  publicKeyPath: string
  /** The public key's full `authorized_keys`-ready line (e.g. `ssh-ed25519 AAAA... comment`). */
  publicKey: string
  /** Which code path produced the key — see KeyGenerator.ts for why this matters for passphrase support. */
  method: 'ssh-keygen' | 'builtin'
}

/**
 * A saved session found in a third-party client's config during an import
 * scan — not yet a Ferry site until the user picks it and it's created via
 * the normal `sites:create` path. Never carries a password: WinSCP's stored
 * password is only reversibly *obfuscated* (not real encryption) and PuTTY
 * doesn't store passwords at all, so importing one reliably without risking a
 * silently-wrong decoded credential is out of scope — the user re-enters it
 * after import, same as any other password field.
 */
export interface ImportedSessionCandidate {
  source: 'winscp' | 'putty' | 'sshconfig'
  name: string
  host: string
  port: number
  username: string
  privateKeyPath?: string
  remoteInitialPath?: string
  jumpHosts?: JumpHostConfig[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — bookmarks
// ─────────────────────────────────────────────────────────────────────────────

export type BookmarkScope = 'local' | 'remote'

/**
 * A quick-jump bookmark for a directory path — separate from saved sites'
 * group organization, which only organizes *sites* themselves, not
 * directories within one. Local bookmarks are global (`siteId` absent —
 * there's exactly one local pane, not one per site); remote bookmarks belong
 * to a specific saved site and are cascade-deleted when that site is.
 */
export interface Bookmark {
  id: string
  scope: BookmarkScope
  siteId?: string
  path: string
  label: string
  createdAt: string
}

export interface BookmarkInput {
  scope: BookmarkScope
  siteId?: string
  path: string
  label: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — sessions
// ─────────────────────────────────────────────────────────────────────────────

/** Live SSH connection state for a session. */
export type SessionStatus = 'connecting' | 'connected' | 'error' | 'disconnected'

/** Result of opening a session. */
export interface SessionOpenResult {
  sessionId: string
  status: SessionStatus
  /** Configured local start directory for this site/session, if any. */
  localInitialPath?: string
}

/** Request payload for `session:open` — connect from a saved site, or ad hoc. */
export interface SessionOpenRequest {
  sessionId: string
  siteId?: string
  quickConnect?: QuickConnectInput
  /** Set only on a user-confirmed retry after a host-key-mismatch warning, scoped to the exact
   * host:port that mismatched — see `SessionManager.openFromSite`. */
  trustedHostKey?: { host: string; port: number }
}

export interface SessionProgressEvent {
  sessionId: string
  message: string
}

/** One challenge within a keyboard-interactive auth round (e.g. an OTP/2FA code prompt). */
export interface KeyboardInteractivePrompt {
  prompt: string
  /** False for a password-style prompt the UI should mask. */
  echo: boolean
}

/**
 * Push-event payload for `session:keyboard-interactive-prompt` — sent only for
 * prompts the saved password couldn't auto-answer (e.g. a genuine 2FA/OTP
 * challenge, not a plain "Password:" re-ask).
 */
export interface KeyboardInteractiveRequestEvent {
  requestId: string
  sessionId: string
  name: string
  instructions: string
  prompts: KeyboardInteractivePrompt[]
}

/** Push-event payload for `session:host-key-prompt` — first connect to a host:port with no stored fingerprint. */
export interface HostKeyPromptEvent {
  requestId: string
  sessionId: string
  host: string
  port: number
  fingerprint: string
  algorithm?: string
  role?: 'jump' | 'target'
  hopIndex?: number
}

/** Request payload for `session:host-key-respond`. */
export interface HostKeyRespondRequest {
  requestId: string
  accept: boolean
}

/** Request payload for `session:keyboard-interactive-respond`. */
export interface KeyboardInteractiveRespondRequest {
  requestId: string
  /** Must be the same length as the originating event's `prompts`. */
  responses: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — filesystem
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One entry in a directory listing (local or remote).
 *
 * Symlink semantics (deliberate): `isDir` always reflects the *resolved*
 * target (Ferry follows symlinked directories transparently on navigate, no
 * confirmation prompt) so existing navigation code needs no symlink-specific
 * branch. `symlinkBroken` entries are shown, not hidden, with `isDir: false`
 * and no `symlinkTarget` — navigating into one hits the ordinary
 * directory-load error path rather than a dedicated dialog.
 */
export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  modifiedAt: string | null
  permissions?: string
  isSymlink: boolean
  /** Present only when `isSymlink` and the link target resolved successfully. */
  symlinkTarget?: string
  /** Present only when `isSymlink` and the target could not be resolved (dangling or circular). */
  symlinkBroken?: boolean
}

/** Result of listing a directory — includes the resolved absolute path. */
export interface FileListResult {
  path: string
  entries: FileEntry[]
}

/** Result of reading a text file's content for preview — capped, never the full file for huge logs. */
export interface FileReadResult {
  path: string
  content: string
  truncated: boolean
  size: number
}

/** Maximum number of files and directories accepted in one staged OS drop. */
export const MAX_STAGE_DROP_ENTRIES = 1000

/** Maximum nested directory depth accepted in one staged OS drop. */
export const MAX_STAGE_DROP_DEPTH = 100

/** One external OS file/folder dropped onto the webview when host filesystem paths aren't exposed directly. */
export interface StageDropEntryInput {
  relativePath: string
  isDir: boolean
  data?: Uint8Array
  modifiedAt?: string
}

/** Request payload for `fs:local:stage-drop`. */
export interface StageDropRequest {
  entries: StageDropEntryInput[]
}

/** Request payload for `fs:local:stage-drop-begin`. */
export interface StageDropBeginRequest {
  dirs?: string[]
}

/** Response payload for `fs:local:stage-drop-begin`. */
export interface StageDropBeginResult {
  stageId: string
}

/** Request payload for `fs:local:stage-drop-finish` and `fs:local:stage-drop-abort`. */
export interface StageDropSessionRequest {
  stageId: string
}

/** Request payload for `fs:local:cleanup-staged-drop`. */
export interface CleanupStagedDropRequest {
  paths: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — transfers
// ─────────────────────────────────────────────────────────────────────────────

export type TransferKind = 'upload' | 'download'
export type TransferState = 'queued' | 'started' | 'progress' | 'paused' | 'done' | 'error' | 'cancelled'

/** Request payload for `transfer:enqueue`. */
export interface TransferEnqueueRequest {
  sessionId: string
  kind: TransferKind
  localPath: string
  remotePath: string
  /** True to recursively transfer a whole directory tree instead of a single file. */
  isDir?: boolean
  createParents?: boolean
}

/** Result of enqueueing a transfer. */
export interface TransferEnqueueResult {
  transferId: string
}

/** Push-event payload for the `transfer:event` channel. */
export interface TransferEvent {
  transferId: string
  kind: TransferKind
  state: TransferState
  sessionId?: string
  localPath?: string
  remotePath?: string
  isDir?: boolean
  bytesTransferred?: number
  totalBytes?: number
  bytesPerSec?: number
  etaMs?: number
  filesDone?: number
  filesTotal?: number
  error?: string
  reconnectRequired?: boolean
  restartRequired?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — long-running operations (Activity dock tab)
// ─────────────────────────────────────────────────────────────────────────────

/** Request payload for `fs:remote:admin` - recursive chmod and/or chown via exec. */
export interface RemoteAdminRequest {
  sessionId: string
  path: string
  mode?: string
  owner?: string
  group?: string
  recursive?: boolean
}

export type OperationKind =
  | 'extract-remote'
  | 'compress-remote'
  | 'compress-local'
  | 'copy-local'
  | 'copy-remote'
  | 'delete-remote'
  | 'delete-remote-batch'
  | 'chmod-remote'
  | 'edit-download'
  | 'edit-reupload'
  | 'sync'

export type OperationState = 'started' | 'progress' | 'done' | 'error' | 'cancelled'

/**
 * Push-event payload for the `operation:event` channel — the generic
 * long-running-operation counterpart of TransferEvent. Progress fields are
 * optional: absent means the operation is indeterminate and the renderer shows
 * an animated bar plus elapsed time derived from `startedAt`.
 */
export interface OperationEvent {
  operationId: string
  kind: OperationKind
  state: OperationState
  /** Human label, e.g. "Extracting report.zip" — sent on every event (merge-safe). */
  label: string
  /** Absent for purely-local operations (compress-local). */
  sessionId?: string
  /** Epoch ms — the renderer derives elapsed time from this; no per-second events. */
  startedAt: number
  cancellable: boolean
  progressCurrent?: number
  progressTotal?: number
  progressUnit?: 'bytes' | 'items'
  error?: string
  requestId?: string
  summary?: string
}

/** Request payload for `fs:remote:deleteMany`. */
export interface DeleteManyRequest {
  sessionId: string
  paths: string[]
}

/** Result of `fs:remote:deleteMany` — per-path outcomes so the renderer patches its listing once. */
export interface DeleteManyResult {
  deletedPaths: string[]
  failures: { path: string; error: string }[]
}

/** Request payload for `fs:local:copy`. */
export interface LocalCopyRequest {
  sourcePaths: string[]
  targetDir: string
}

/** Request payload for `fs:remote:copy`. */
export interface RemoteCopyRequest {
  sessionId: string
  sourcePaths: string[]
  targetDir: string
}

/** Single copied item mapping returned by local/remote copy operations. */
export interface CopyItemResult {
  sourcePath: string
  targetPath: string
}

/** Result of `fs:local:copy` and `fs:remote:copy`. */
export interface CopyManyResult {
  copied: CopyItemResult[]
  failures: { path: string; error: string }[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — persisted history (transfers + operations)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One completed transfer or operation, persisted beyond the live Activity
 * dock (which only shows current/recent items) for later review. Recorded
 * automatically from TransferQueue/OperationRegistry's terminal events — see
 * HistoryRecorder.ts.
 */
export interface HistoryEntry {
  id: string
  kind: 'transfer' | 'operation'
  label: string
  /** Present only for kind: 'transfer'. */
  direction?: TransferKind
  /** Present only for kind: 'operation'. */
  operationKind?: OperationKind
  sessionId?: string
  /** Denormalized at record time — the site could be renamed/deleted later. */
  siteName?: string
  bytes?: number
  startedAt: number
  finishedAt: number
  status: 'done' | 'error' | 'cancelled'
  error?: string
}

export interface HistoryQuery {
  search?: string
  status?: HistoryEntry['status']
  limit?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — one-way directory sync (mirror)
// ─────────────────────────────────────────────────────────────────────────────

export type SyncDirection = 'push' | 'pull'

export interface SyncOptions {
  sessionId: string
  localPath: string
  remotePath: string
  direction: SyncDirection
  /** When true, deletes destination-only top-level entries not present anywhere in the source — the destructive half of "mirror," off by default. */
  deleteExtras: boolean
}

export interface SyncPlanEntry {
  relPath: string
  size: number
  action?: 'new' | 'overwrite'
}

/** Preview of what a sync run would do — shown to the user before they confirm, since `deleteExtras` can remove real destination data with no undo. */
export interface SyncPlan {
  toTransfer: SyncPlanEntry[]
  toDelete: string[]
  totalBytes: number
}

export type CompareStatus = 'same' | 'localOnly' | 'remoteOnly' | 'localNewer' | 'remoteNewer' | 'sizeDiff'

export interface CompareRequest {
  sessionId: string
  localPath: string
  remotePath: string
}

export interface CompareRow {
  relPath: string
  status: CompareStatus
  localSize?: number
  remoteSize?: number
  localMtimeMs?: number
  remoteMtimeMs?: number
}

export type FileDiffLineKind = 'context' | 'add' | 'remove'

export interface FileDiffLine {
  kind: FileDiffLineKind
  text: string
  /** 1-based line number in the local file, or null for added lines. */
  localLine: number | null
  /** 1-based line number in the remote file, or null for removed lines. */
  remoteLine: number | null
}

export interface FileDiffHunk {
  localStart: number
  localCount: number
  remoteStart: number
  remoteCount: number
  lines: FileDiffLine[]
}

export type FileDiffSkipReason = 'binary' | 'too-large'

export interface FileDiffRequest {
  sessionId: string
  localPath: string
  remotePath: string
  /** Optional in-memory local text (e.g. unsaved buffer in EditorDialog). */
  localContent?: string
  /** True when the remote file requires passwordless sudo (opened via Edit as root). */
  viaSudo?: boolean
}

export interface FileDiffResult {
  localPath: string
  remotePath: string
  localSize: number
  remoteSize: number
  maxBytes: number
  skipped?: {
    reason: FileDiffSkipReason
    side: 'local' | 'remote' | 'both'
    message: string
  }
  identical: boolean
  additions: number
  deletions: number
  hunks: FileDiffHunk[]
  /** True when the edit script exceeded the Myers cap and fell back to a simplified hunk. */
  simplified?: boolean
  /** Count of changed lines omitted when `simplified` caps per-side output. */
  omittedLines?: number
}

export interface SyncRunRequest {
  requestId: string
  options: SyncOptions
  approvedPlan: SyncPlan
}

export interface SyncRunResult {
  queuedTransferIds: string[]
  deletedCount: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — remote log tail
// ─────────────────────────────────────────────────────────────────────────────

/** Request payload for `tail:start`. */
export interface TailStartRequest {
  sessionId: string
  remotePath: string
  historyLines?: number
}

/** Result of starting a tail — the caller uses `tailId` to route events and to stop. */
export interface TailStartResult {
  tailId: string
}

/** Payload for the `tail:ready` channel — emitted once the remote tail command starts producing output/PID marker. */
export interface TailReadyEvent {
  tailId: string
}

/** Payload for the `tail:line` channel. */
export interface TailLineEvent {
  tailId: string
  line: string
}

/** Payload for the `tail:notice` channel (e.g. remote file truncated/rotated). */
export interface TailNoticeEvent {
  tailId: string
  message: string
}

/** Payload for the `tail:end` channel. */
export interface TailEndEvent {
  tailId: string
  /** Present when the stream ended because of an unrecoverable error. */
  error?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — edit in external editor
// ─────────────────────────────────────────────────────────────────────────────

export interface EditOpenRemoteRequest {
  sessionId: string
  path: string
  builtin?: boolean
  viaSudo?: boolean
}

export interface EditOpenExternalRequest {
  editId: string
}

export interface EditOpenResult {
  editId: string
  localTempPath: string
}

/** One open edit session, as returned by `edit:list` — a public-safe snapshot of main-process state, used to hydrate the renderer's Open Edits dock tab on load (the `edit:event` stream alone only covers edits opened after that point). */
export interface OpenEditSnapshot {
  editId: string
  sessionId: string
  remotePath: string
  localTempPath: string
  /** True if the local temp file has unsaved-to-server changes (mtime newer than the last successful upload). */
  dirty: boolean
  /** True if the underlying SSH session has closed — further changes won't be uploaded. */
  sessionClosed: boolean
  /** True if this edit session reads/writes the remote file via sudo. */
  viaSudo?: boolean
}

/**
 * Push-event payload for `edit:event` — one edit session's lifecycle.
 * `opened` fires once after the initial download and `shell.openPath()`;
 * `reuploading`/`reuploaded`/`upload-error` fire on every subsequent save
 * (an edit session stays open across many saves, it's not one-shot);
 * `session-closed` fires if the underlying SSH session disconnects while
 * still being watched — the temp file survives, but further saves won't sync.
 */
export interface EditEvent {
  editId: string
  sessionId?: string
  remotePath?: string
  localTempPath: string
  state: 'opened' | 'reuploading' | 'reuploaded' | 'upload-error' | 'remote-changed' | 'session-closed' | 'closed'
  error?: string
  viaSudo?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — terminal
// ─────────────────────────────────────────────────────────────────────────────

/** Request payload for `terminal:open`. */
export interface TerminalOpenRequest {
  sessionId: string
  cols: number
  rows: number
}

/** Result of opening an interactive SSH shell (PTY) for a session. */
export interface TerminalOpenResult {
  terminalId: string
}

/** Payload for the `terminal:data` channel — UTF-8 decoded terminal output (or raw bytes). */
export interface TerminalDataEvent {
  terminalId: string
  data: string | Uint8Array
}

/** Payload for the `terminal:exit` channel. */
export interface TerminalExitEvent {
  terminalId: string
  exitCode: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — remote resource monitor
// ─────────────────────────────────────────────────────────────────────────────

/** Request payload for `monitor:start`. */
export interface MonitorStartRequest {
  sessionId: string
  intervalMs?: number
}

/** Disk usage (bytes + optional mount point & inode stats) from `df -Pk` / `df -Pi`. */
export interface MonitorDiskUsage {
  totalBytes: number
  usedBytes: number
  availableBytes: number
  mountPoint?: string
  inodesTotal?: number
  inodesUsed?: number
  inodesAvailable?: number
}

/** Capped recursive local folder scan result for upload pre-flight safety & size checks. */
export interface LocalUploadScanResult {
  relativePaths: string[]
  totalBytes: number
  truncated: boolean
}

export type RemoteInitSystem = 'systemd' | 'openrc' | 'sysvinit' | 'launchd' | 'unknown'

/** Automatically probed remote host OS, distro, shell, and init system metadata. */
export interface RemoteHostInfo {
  os: string
  distro?: string
  kernel?: string
  arch?: string
  shell?: string
  initSystem: RemoteInitSystem
}

/** Push-event payload for `session:host-info`. */
export interface SessionHostInfoEvent {
  sessionId: string
  info: RemoteHostInfo
}

/**
 * One remote resource sample (Monitor dock tab). `cpu` is null on the very
 * first tick after a (re)start — CPU% needs two consecutive /proc/stat
 * readings to compute a delta; memory/load/uptime are immediate.
 */
export interface MonitorSample {
  sessionId: string
  /** Epoch ms when the sample was taken (main-process clock). */
  timestamp: number
  cpu: {
    /** 0–100 aggregate across all cores. */
    aggregatePct: number
    /** 0–100 per core, index = core number. */
    perCorePct: number[]
    coreCount: number
  } | null
  memory: {
    totalBytes: number
    /** total − available — the honest "used" figure, not total − free. */
    usedBytes: number
    availableBytes: number
    buffersBytes: number
    cachedBytes: number
  }
  swap: {
    totalBytes: number
    usedBytes: number
  }
  /** Root filesystem ("/") usage — null if `df` failed/unavailable (not fatal, unlike a missing /proc/stat). */
  disk: MonitorDiskUsage | null
  /** Top processes by combined CPU+RAM score, capped at MAX_PROCESSES — see procParse.ts's capProcesses. */
  processes: MonitorProcessSample[]
  /** Full process count before capping, so the UI can show "showing top N of M". */
  processTotalCount: number
  loadAvg: [number, number, number]
  uptimeSec: number
}

/** One process's resolved figures for a single Monitor tick. */
export interface MonitorProcessSample {
  pid: number
  /** comm — process name, truncated to 15 chars by the kernel like `ps`/`top` show. */
  name: string
  /** Optional truncated `/proc/[pid]/cmdline` for top hot processes. */
  cmdline?: string
  /** 0–100, on the same scale as MonitorSample.cpu.aggregatePct — null until a second consecutive sample exists for this pid. */
  cpuPct: number | null
  rssBytes: number
}

export type MonitorStatus = 'started' | 'stopped' | 'unsupported' | 'error'

/** Push-event payload for the `monitor:status` channel. */
export interface MonitorStatusEvent {
  sessionId: string
  state: MonitorStatus
  message?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — archive creation ("compress to zip")
// ─────────────────────────────────────────────────────────────────────────────

/** Request payload for `archive:compressLocal`. */
export interface CompressLocalRequest {
  sourcePath: string
  destPath: string
}

/** Request payload for `archive:compressRemote`. */
export interface CompressRemoteRequest {
  sessionId: string
  sourcePath: string
  destPath: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — remote unzip
// ─────────────────────────────────────────────────────────────────────────────

/** Request payload for `unzip:run`. */
export interface UnzipRunRequest {
  sessionId: string
  archivePath: string
  targetDir: string
}

/** Result of running `unzip` on the remote server. */
export interface UnzipResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — system paths
// ─────────────────────────────────────────────────────────────────────────────

/** Result of resolving an OS-standard directory path. */
export interface DownloadsPathResult {
  path: string
}

/** Result of reading the running app's version (always reflects `package.json`). */
export interface AppVersionResult {
  version: string
}

/** Result of reading the OS clipboard's current text content (main-process side). */
export interface ClipboardTextResult {
  text: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — auto-update
// ─────────────────────────────────────────────────────────────────────────────

/** Payload for the `update:available` channel — a newer version is being downloaded in the background. */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'
  | 'disabled'

export interface UpdateProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  availableVersion?: string
  progress?: UpdateProgress
  error?: string
  lastCheckedAt?: string
}

export interface CheckUpdateResult {
  status: UpdateStatus
  version?: string
  error?: string
}

export interface UpdateAvailableEvent {
  version: string
}

/** Payload for the `update:downloaded` channel — a restart will install `version`. */
export interface UpdateDownloadedEvent {
  version: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — persisted app settings
// ─────────────────────────────────────────────────────────────────────────────

/** Current version of Ferry's Privacy Policy and Terms of Service. */
export const LEGAL_POLICY_VERSION = '1.0'

/** Recorded local acceptance of Ferry's Privacy Policy and Terms of Service. */
export interface TermsAcceptance {
  version: string
  acceptedAt: string
}

/** Trusted SSH host-key fingerprint stored in `known_hosts.json`. */
export interface KnownHostEntry {
  hostPort: string
  fingerprint: string
}

export interface UiPrefUpdate {
  key: string
  value: string | null
}

/**
 * App-wide settings persisted across restarts (not per-session/domain state) —
 * mirrors `ui.store.ts`'s `localStorage` prefs, but for state only the main
 * process can own (which site tabs were open; a transfer-wide rate limit).
 */
export interface AppSettings {
  /** Saved-site ids of tabs open at last shutdown, in tab order — restored (not auto-connected) on next launch. */
  openTabSiteIds: string[]
  /** Global transfer rate cap in KB/s, or null for unlimited. */
  bandwidthLimitKBps: number | null
  /** App-wide default proxy, used by any site whose own `proxyMode` is `'inherit'` (or absent) — null/absent means no default. */
  defaultProxy?: ProxyInfo
  /** Whether Ferry automatically checks for updates on startup and periodically in the background. */
  autoCheckUpdates?: boolean
  /** Maximum age (in days) for transfer/operation history entries, or null for unlimited. */
  historyRetentionDays?: number | null
  /** Local acceptance record for Privacy Policy and Terms of Service. */
  termsAcceptance?: TermsAcceptance | null
  /** Persisted `ferry:ui:*` renderer preferences (survives Neutralino ephemeral localhost ports). */
  uiPrefs?: Record<string, string>
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — window chrome
// ─────────────────────────────────────────────────────────────────────────────

/** Payload for the `window:state-change` channel. */
export interface WindowStateEvent {
  isMaximized: boolean
  isMinimized?: boolean
  isFullScreen?: boolean
}

/** Result of querying the current window's maximized state. */
export interface WindowIsMaximizedResult {
  isMaximized: boolean
}

/** Result of querying the full window state. */
export interface WindowStateResult {
  isMaximized: boolean
  isMinimized: boolean
  isFullScreen: boolean
}

/** Theme sync payload sent to the Windows native host window (`window:syncTheme`). */
export interface WindowThemeSyncInput {
  theme: 'light' | 'dark'
  /** Win32 COLORREF (`0x00BBGGRR`) for Windows 11 `DWMWA_CAPTION_COLOR`. */
  captionColor?: number
}

/** Pixel rectangle in virtual desktop coordinates. */
export interface DisplayBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Native monitor geometry returned by the Windows host helper. */
export interface NativeDisplayInfo {
  bounds: DisplayBounds
  workArea: DisplayBounds
  isPrimary: boolean
  scaleFactor: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Channels — request/response (invoke)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The complete invoke-channel namespace. The renderer calls
 * `window.api.invoke(channel, …)` and always receives an {@link IpcResult}.
 */
export const INVOKE_CHANNELS = {
  // saved sites
  sitesList: 'sites:list',
  sitesCreate: 'sites:create',
  sitesUpdate: 'sites:update',
  sitesDelete: 'sites:delete',
  sitesDuplicate: 'sites:duplicate',
  sitesImportScan: 'sites:import-scan',
  sitesExport: 'sites:export',
  sitesImportJson: 'sites:import-json',
  // app settings
  settingsGet: 'settings:get',
  settingsSetOpenTabs: 'settings:setOpenTabs',
  settingsSetBandwidthLimit: 'settings:setBandwidthLimit',
  settingsSetDefaultProxy: 'settings:setDefaultProxy',
  settingsSetAutoCheckUpdates: 'settings:setAutoCheckUpdates',
  settingsSetHistoryRetention: 'settings:setHistoryRetention',
  settingsAcceptTerms: 'settings:acceptTerms',
  settingsSetUiPref: 'settings:setUiPref',
  // privacy & known hosts
  knownHostsList: 'knownHosts:list',
  knownHostsForget: 'knownHosts:forget',
  knownHostsClear: 'knownHosts:clear',
  privacyExportData: 'privacy:exportData',
  privacyDeleteAllData: 'privacy:deleteAllData',
  // sessions
  sessionOpen: 'session:open',
  sessionClose: 'session:close',
  sessionKeyboardInteractiveRespond: 'session:keyboard-interactive-respond',
  sessionHostKeyRespond: 'session:host-key-respond',
  // local filesystem
  fsLocalList: 'fs:local:list',
  fsLocalMkdir: 'fs:local:mkdir',
  fsLocalRename: 'fs:local:rename',
  fsLocalCopy: 'fs:local:copy',
  fsLocalDelete: 'fs:local:delete',
  fsLocalStageDrop: 'fs:local:stage-drop',
  fsLocalStageDropBegin: 'fs:local:stage-drop-begin',
  fsLocalStageDropFinish: 'fs:local:stage-drop-finish',
  fsLocalStageDropAbort: 'fs:local:stage-drop-abort',
  fsLocalCleanupStagedDrop: 'fs:local:cleanup-staged-drop',
  fsLocalScanUploadPaths: 'fs:local:scanUploadPaths',
  // remote filesystem (SFTP)
  fsRemoteList: 'fs:remote:list',
  fsRemoteDiskUsage: 'fs:remote:diskUsage',
  fsRemoteMkdir: 'fs:remote:mkdir',
  fsLocalTouch: 'fs:local:touch',
  fsRemoteTouch: 'fs:remote:touch',
  fsRemoteRename: 'fs:remote:rename',
  fsRemoteCopy: 'fs:remote:copy',
  fsRemoteDelete: 'fs:remote:delete',
  fsRemoteDeleteMany: 'fs:remote:deleteMany',
  fsRemoteChmod: 'fs:remote:chmod',
  fsRemoteAdmin: 'fs:remote:admin',
  fsLocalReadFile: 'fs:local:readFile',
  fsLocalWriteFile: 'fs:local:writeFile',
  fsRemoteReadFile: 'fs:remote:readFile',
  // transfers
  transferEnqueue: 'transfer:enqueue',
  transferCancel: 'transfer:cancel',
  transferRetry: 'transfer:retry',
  transferPause: 'transfer:pause',
  // remote log tail
  tailStart: 'tail:start',
  tailStop: 'tail:stop',
  // edit in external editor
  editOpenLocal: 'edit:openLocal',
  editOpenRemote: 'edit:openRemote',
  editOpenExternal: 'edit:openExternal',
  editClose: 'edit:close',
  editForceReupload: 'edit:forceReupload',
  editList: 'edit:list',
  // terminal
  terminalOpen: 'terminal:open',
  terminalClose: 'terminal:close',
  // remote unzip
  unzipRun: 'unzip:run',
  // long-running operations (Activity dock tab)
  operationCancel: 'operation:cancel',
  // remote resource monitor
  monitorStart: 'monitor:start',
  monitorStop: 'monitor:stop',
  // archive creation ("compress to zip")
  archiveCompressLocal: 'archive:compressLocal',
  archiveCompressRemote: 'archive:compressRemote',
  // bookmarks
  bookmarksList: 'bookmarks:list',
  bookmarksCreate: 'bookmarks:create',
  bookmarksDelete: 'bookmarks:delete',
  bookmarksCopyToSite: 'bookmarks:copyToSite',
  // persisted transfer/operation history
  historyList: 'history:list',
  historyClear: 'history:clear',
  // one-way directory sync (mirror)
  syncPreview: 'sync:preview',
  syncRun: 'sync:run',
  syncCompare: 'sync:compare',
  syncDiffFiles: 'sync:diffFiles',
  // native dialogs
  dialogPickFile: 'dialog:pickFile',
  dialogPickFolder: 'dialog:pickFolder',
  dialogPickSaveFile: 'dialog:pickSaveFile',
  // SSH key generation
  keysGenerate: 'keys:generate',
  // system paths
  systemGetDownloadsPath: 'system:getDownloadsPath',
  systemGetAppVersion: 'system:getAppVersion',
  systemStartDrag: 'system:startDrag',
  systemClipboardReadText: 'system:clipboardReadText',
  // window chrome
  windowMinimize: 'window:minimize',
  windowMaximizeToggle: 'window:maximizeToggle',
  windowFullScreenToggle: 'window:fullScreenToggle',
  windowClose: 'window:close',
  windowShow: 'window:show',
  windowSetTitle: 'window:setTitle',
  windowIsMaximized: 'window:isMaximized',
  windowGetState: 'window:getState',
  windowSyncTheme: 'window:syncTheme',
  windowGetDisplays: 'window:getDisplays',
  // auto-update
  updateCheck: 'update:check',
  updateGetStatus: 'update:getStatus',
  updateInstallNow: 'update:installNow',
  // companion
  companionGetReleases: 'companion:getReleases',
  companionAiGetConfig: 'companion:ai:getConfig',
  companionAiSetConfig: 'companion:ai:setConfig',
  companionAiTest: 'companion:ai:test',
  companionAiChat: 'companion:ai:chat',
  companionAiCancel: 'companion:ai:cancel',
  // profiling
  profileReport: 'profile:report'
} as const

export type CompanionAiProvider = 'none' | 'gemini' | 'ferry-pro'
export type CompanionTier = 'free' | 'pro'
export type CompanionCommandRisk = 'read_only' | 'mutating' | 'destructive'

export const DEFAULT_GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com'
export const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen'
export const GEMINI_MODEL_OPTIONS = [
  'gemini-4-hydrogen',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-4-argon',
  'gemini-4-neon',
  'gemini-4-carbon'
] as const

/**
 * Upgrades empty or retired/retiring legacy Gemini models (1.0, 1.5, 2.0, 2.5-pro, 2.5-flash)
 * to current `gemini-4-hydrogen`, while preserving still-active `gemini-2.5-flash-lite` and all 3.x/4.x models.
 */
export function normalizeGeminiModel(raw: string): string {
  const trimmed = raw.trim()
  if (
    !trimmed ||
    /^gemini-(?:1\.0|1\.5|2\.0)-/i.test(trimmed) ||
    /^gemini-2\.5-pro(?:$|-)/i.test(trimmed) ||
    /^gemini-2\.5-flash(?!-lite(?:$|-))(?:$|-)/i.test(trimmed)
  ) {
    return DEFAULT_GEMINI_MODEL
  }
  return trimmed
}

export interface CompanionCommandCard {
  command: string
  description: string
  risk: CompanionCommandRisk
}

export type CompanionUiActionCard =
  | { kind: 'open-editor'; remotePath: string; label: string }
  | { kind: 'tail-log'; remotePath: string; label: string }
  | { kind: 'apply-filter'; mode: 'include' | 'exclude'; pattern: string; label: string }

export interface CompanionStructuredOutput {
  summary: string
  rootCause?: string
  commandCards?: CompanionCommandCard[]
  uiActionCards?: CompanionUiActionCard[]
}

/**
 * Normalizes a shell command for deterministic risk classification:
 * - Strips single-quoted literal contents (POSIX shells never expand inside `'...'`).
 * - Strips plain text inside double-quoted strings while preserving `$(...)` and backtick substitutions.
 * - Unescapes backslash-obfuscated word characters (e.g. `r\m` -> `rm`).
 */
function normalizeCommandForRiskCheck(command: string): string {
  let out = ''
  let i = 0
  const len = command.length
  while (i < len) {
    const ch = command[i]
    if (ch === "'") {
      // Single-quoted literal: preserve quotes as empty literal
      out += "''"
      i += 1
      while (i < len && command[i] !== "'") i += 1
      if (i < len) i += 1
      continue
    }
    if (ch === '"') {
      // Double-quoted string: strip inert text, keep $(...) and `...` command substitutions
      out += '"'
      i += 1
      while (i < len && command[i] !== '"') {
        if (command[i] === '\\' && i + 1 < len) {
          i += 2
          continue
        }
        if (command[i] === '$' && command[i + 1] === '(') {
          let depth = 1
          out += '$('
          i += 2
          while (i < len && depth > 0) {
            if (command[i] === '(') depth += 1
            else if (command[i] === ')') depth -= 1
            out += command[i]
            i += 1
          }
          continue
        }
        if (command[i] === '`') {
          out += '`'
          i += 1
          while (i < len && command[i] !== '`') {
            out += command[i]
            i += 1
          }
          if (i < len) {
            out += '`'
            i += 1
          }
          continue
        }
        i += 1
      }
      out += '"'
      if (i < len) i += 1
      continue
    }
    if (ch === '\\' && i + 1 < len && /[A-Za-z0-9_/-]/.test(command[i + 1])) {
      // Unescape backslash-obfuscated tokens like `r\m -rf /`
      out += command[i + 1]
      i += 2
      continue
    }
    out += ch
    i += 1
  }
  return out
}

const DESTRUCTIVE_COMMAND_RE =
  /(\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\b|--recursive\b|--force\b)|\bunlink\b|\bfind\b[^\r\n]*\s-delete\b|\bfind\b[^\r\n]*\s-exec(?:dir)?\b[^\r\n]*\b(?:rm|unlink|shred|truncate|dd|kill|chmod\s+(?:-R\s+)?000|(?:ba|z|da|k)?sh)\b|\bxargs\b[^\r\n]*\b(?:rm|unlink|shred|truncate|kill)\b|\bshred\b|\bwipefs\b|\bmkfs(?:\.\w+)?\b|\bfdisk\b|\bparted\b|\bdd\s+if=|\bshutdown\b|\breboot\b|\bpoweroff\b|\bhalt\b|\binit\s+[06]\b|\bkill\s+(?:-(?:9|KILL|SIGKILL)\b|-s\s*(?:9|KILL|SIGKILL)\b)|\bkillall\b|\bpkill\b|\btruncate\b|\biptables\s+-F\b|\bufw\s+disable\b|\bsystemctl\s+(?:stop|disable|mask)\b|\bservice\s+\S+\s+stop\b|\bdocker\s+(?:rm|rmi|system\s+prune)\b|\bdocker(?:[\s-]+)compose\b[^\r\n]*\bdown\b[^\r\n]*(?:-v\b|--volumes\b)|\bchmod\s+(?:-R\s+)?(?:777|000)\b|\bgit\s+push\b[^\r\n]*(?:--force(?:-with-lease)?\b|-f\b)|\brsync\b[^\r\n]*--delete(?:-(?:before|during|after|delay|excluded))?\b|\bkubectl\s+delete\b|\bterraform\s+destroy\b|\b(?:ba|z|da|k)?sh\s+-[a-zA-Z]*c\b|\beval\b|<\(|\|\s*(?:sudo\s+)?(?:env\s+)?(?:ba|z|da|k)?sh\b|\bcurl\b[^\r\n]*(?:(?:-d|--data(?:-(?:raw|binary|urlencode|ascii))?)\s*@|(?:-F|--form)\s+\S+=@|(?:-T|--upload-file)\s+)|(?:^|[;&|]\s*):\s*>\s*(?!\/dev\/null\b)|\b(?:echo|printf|cat)\b[^\r\n]*>\s*\/(?:dev\/(?!null\b)|etc\/|boot\/|usr\/|bin\/|sbin\/|lib\/|var\/log\/|root\/)|>\s*(?:\/(?:dev\/(?!null\b)|etc\/|boot\/|usr\/|bin\/|sbin\/|lib\/|var\/log\/|root\/)|~\/\.ssh\/)|\bdrop\s+(?:table|database|schema)\b|:\(\)\s*\{)/i

const MUTATING_COMMAND_RE =
  /(\brm\b|\bmv\b|\bcp\b|\bmkdir\b|\btouch\b|\bchmod\b|\bchown\b|\bchgrp\b|\bln\b|\bsed\s+-i\b|\btee\b|\bcrontab\b|\buseradd\b|\busermod\b|\buserdel\b|\bpasswd\b|\bufw\b|\biptables\b|\bsysctl\s+-w\b|\bkill\s+(?:-\S+\s+)*\d+\b|\bfind\b[^\r\n]*\s-exec(?:dir)?\b|\bsystemctl\s+(?:restart|reload|start|enable)\b|\bservice\s+\S+\s+(?:restart|reload|start)\b|\b(?:apt|apt-get|yum|dnf|apk|pacman|brew|npm|pnpm|yarn|pip)\s+(?:install|remove|purge|update|upgrade|add)\b|\bgit\s+(?:push|reset|clean|checkout|merge|rebase)\b|\bdocker\s+(?:restart|stop|start|run|exec)\b|\btar\s+-[a-zA-Z]*x|\bunzip\b|\$\(|`[^`]+`|(?:^|[^0-9>&])>>?\s*(?!&)(?!\/dev\/null\b)\S+)/i

const RISK_ORDER: Record<CompanionCommandRisk, number> = {
  read_only: 0,
  mutating: 1,
  destructive: 2
}

/** Classifies a shell command's safety risk deterministically without trusting model labels alone. */
export function classifyCommandRisk(command: string): CompanionCommandRisk {
  const normalized = normalizeCommandForRiskCheck(command)
  if (DESTRUCTIVE_COMMAND_RE.test(normalized)) return 'destructive'
  if (MUTATING_COMMAND_RE.test(normalized)) return 'mutating'
  return 'read_only'
}

/** Strips ANSI CSI escapes and ASCII control chars so hidden newline/control sequences cannot hide inside one command card. */
export function sanitizeCompanionCommand(raw: string, maxLen = 500): string {
  return raw
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, maxLen)
}

/** Ensures a reported risk level is never downgraded below the deterministic command classification. */
export function escalateCommandRisk(reported: CompanionCommandRisk, command: string): CompanionCommandRisk {
  const floor = classifyCommandRisk(command)
  return RISK_ORDER[floor] > RISK_ORDER[reported] ? floor : reported
}

export interface CompanionAiConfigInfo {
  provider: CompanionAiProvider
  endpoint: string
  model: string
  hasApiKey: boolean
}

export interface CompanionAiConfigInput {
  provider: CompanionAiProvider
  endpoint: string
  model: string
  /** Omitting preserves any stored encrypted key; empty string clears it. */
  apiKey?: string
}

export type CompanionAiIntent = 'chat' | 'command' | 'explain-log' | 'diagnose-spike'

export type CompanionSiteEnvironment = 'prod' | 'staging' | 'dev' | 'other'

export interface CompanionWorkspaceSignal {
  siteName?: string
  siteEnvironment?: CompanionSiteEnvironment
  remoteOs?: string
  remoteShell?: string
  remoteCwd?: string
  terminalTail?: string
  sftpSummary?: string
  lastTransferError?: string
  logBasename?: string
  logSnippet?: string
  logPath?: string
  monitorSummary?: string
}

export interface CompanionAiChatRequest {
  requestId?: string
  prompt: string
  history?: Array<{ role: 'user' | 'assistant'; text: string }>
  intent?: CompanionAiIntent
  workspaceSignal?: CompanionWorkspaceSignal
  context: {
    appVersion: string
    isConnected: boolean
    theme: string
  }
}

export interface CompanionAiCancelRequest {
  requestId?: string
}

export interface CompanionAiCancelResult {
  cancelled: boolean
}

export interface CompanionAiStreamEvent {
  requestId: string
  /** Full accumulated clean summary text so far. */
  summaryText: string
}

export interface CompanionAiChatResult {
  ok: boolean
  text?: string
  structured?: CompanionStructuredOutput
  provider?: CompanionAiProvider
  error?: string
}

export interface CompanionReleaseHighlight {
  version: string
  publishedAt: string | null
  title: string
  highlights: string[]
  url: string
  source: 'github' | 'bundled'
}

export interface CompanionReleasesResult {
  releases: CompanionReleaseHighlight[]
  source: 'github' | 'bundled'
  fetchedAt: string | null
  offlineFallback: boolean
  error?: string
}

/** Union of every valid invoke channel string. */
export type InvokeChannel = (typeof INVOKE_CHANNELS)[keyof typeof INVOKE_CHANNELS]

/** Channels owned by the desktop shell host rather than the SSH/SFTP sidecar. */
export const HOST_INVOKE_CHANNELS: readonly InvokeChannel[] = [
  INVOKE_CHANNELS.dialogPickFile,
  INVOKE_CHANNELS.dialogPickFolder,
  INVOKE_CHANNELS.dialogPickSaveFile,
  INVOKE_CHANNELS.systemGetDownloadsPath,
  INVOKE_CHANNELS.systemGetAppVersion,
  INVOKE_CHANNELS.systemStartDrag,
  INVOKE_CHANNELS.systemClipboardReadText,
  INVOKE_CHANNELS.windowMinimize,
  INVOKE_CHANNELS.windowMaximizeToggle,
  INVOKE_CHANNELS.windowFullScreenToggle,
  INVOKE_CHANNELS.windowClose,
  INVOKE_CHANNELS.windowShow,
  INVOKE_CHANNELS.windowSetTitle,
  INVOKE_CHANNELS.windowIsMaximized,
  INVOKE_CHANNELS.windowGetState,
  INVOKE_CHANNELS.profileReport
]

// ─────────────────────────────────────────────────────────────────────────────
// Channels — push events (main → renderer)
// ─────────────────────────────────────────────────────────────────────────────

/** Channels the main process pushes to the renderer via `webContents.send`. */
export const EVENT_CHANNELS = {
  sessionStatus: 'session:status-change',
  sessionProgress: 'session:progress',
  sessionHostInfo: 'session:host-info',
  keyboardInteractivePrompt: 'session:keyboard-interactive-prompt',
  hostKeyPrompt: 'session:host-key-prompt',
  transferEvent: 'transfer:event',
  operationEvent: 'operation:event',
  monitorSample: 'monitor:sample',
  monitorStatus: 'monitor:status',
  tailReady: 'tail:ready',
  tailLine: 'tail:line',
  tailNotice: 'tail:notice',
  tailEnd: 'tail:end',
  editEvent: 'edit:event',
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit',
  windowStateChange: 'window:state-change',
  updateAvailable: 'update:available',
  updateDownloaded: 'update:downloaded',
  updateStatus: 'update:status',
  companionAiStream: 'companion:ai:stream'
} as const

export const SEND_CHANNELS = {
  terminalAck: 'terminal:ack',
  terminalInput: 'terminal:input',
  terminalResize: 'terminal:resize'
} as const

/** Union of every valid fire-and-forget send channel string. */
export type SendChannel = (typeof SEND_CHANNELS)[keyof typeof SEND_CHANNELS]

export interface TerminalAckEvent {
  terminalId: string
  bytes: number
}

export interface TerminalInputEvent {
  terminalId: string
  data: string
}

export interface TerminalResizeEvent {
  terminalId: string
  cols: number
  rows: number
}

/** Union of every valid event channel string. */
export type EventChannel = (typeof EVENT_CHANNELS)[keyof typeof EVENT_CHANNELS]

/** Payload for the `session:status-change` channel. */
export interface SessionStatusEvent {
  sessionId: string
  status: SessionStatus
  message?: string
}

/** Payload for the `profile:report` channel. */
export interface ProfileReportPayload {
  preloadStart: number
  preloadTimeOrigin: number
  rendererStart: number
  rendererTimeOrigin: number
  rendererMount: number
  firstPaint: number
  rendererMountTimeOrigin: number
}

