/**
 * Shared IPC contract — the single source of truth for every channel name,
 * request/response envelope, and push-event payload exchanged between the
 * Electron main process and the renderer.
 *
 * Both `src/preload/index.ts` (whitelist) and the main-process IPC handlers
 * import the channel lists from here, so the two can never silently drift:
 * adding a channel in one place without the other becomes a type error.
 *
 * Design rules:
 *  - Every `invoke` resolves to an {@link IpcResult} envelope, never a raw value.
 *  - Push events (main → renderer) carry typed payloads keyed by channel.
 *  - No runtime dependencies on Electron or Node here — this module is imported
 *    by the sandboxed renderer too.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Result envelope
// ─────────────────────────────────────────────────────────────────────────────

/** Stable, machine-readable error codes surfaced across the IPC boundary. */
export type IpcErrorCode =
  | 'UNKNOWN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'SSH_CONNECT'
  | 'SSH_TIMEOUT'
  | 'SSH_EXEC'
  | 'SFTP'
  | 'CANCELLED'
  | 'UNZIP_NOT_FOUND'
  | 'AUTH'

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
}

/** Discriminated union returned by every `invoke` channel. */
export type IpcResult<T> = IpcOk<T> | IpcErr

/** Convenience constructor for a success envelope. */
export function ok<T>(data: T): IpcOk<T> {
  return { ok: true, data }
}

/** Convenience constructor for an error envelope. */
export function err(code: IpcErrorCode, message: string): IpcErr {
  return { ok: false, code, message }
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — sites / auth
// ─────────────────────────────────────────────────────────────────────────────

/** Supported authentication methods (extensible — 'agent' can be added later). */
export type AuthMethod = 'password' | 'privateKey'

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
  remoteInitialPath?: string
  localInitialPath?: string
  hasPassword: boolean
  hasPassphrase: boolean
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
  remoteInitialPath?: string
  localInitialPath?: string
  password?: string
  passphrase?: string
}

/** An ad-hoc (not saved) connection profile used for quick-connect. */
export interface QuickConnectInput extends SiteInput {}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — sessions
// ─────────────────────────────────────────────────────────────────────────────

/** Live SSH connection state for a session. */
export type SessionStatus = 'connecting' | 'connected' | 'error' | 'disconnected'

/** Result of opening a session. */
export interface SessionOpenResult {
  sessionId: string
  status: SessionStatus
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — filesystem
// ─────────────────────────────────────────────────────────────────────────────

/** One entry in a directory listing (local or remote). */
export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  modifiedAt: string | null
  permissions?: string
}

/** Result of listing a directory — includes the resolved absolute path. */
export interface FileListResult {
  path: string
  entries: FileEntry[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — transfers
// ─────────────────────────────────────────────────────────────────────────────

export type TransferKind = 'upload' | 'download'
export type TransferState = 'queued' | 'started' | 'progress' | 'done' | 'error' | 'cancelled'

/** Result of enqueueing a transfer. */
export interface TransferEnqueueResult {
  transferId: string
}

/** Push-event payload for the `transfer:event` channel. */
export interface TransferEvent {
  transferId: string
  kind: TransferKind
  state: TransferState
  bytesTransferred?: number
  totalBytes?: number
  bytesPerSec?: number
  etaMs?: number
  error?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — remote log tail
// ─────────────────────────────────────────────────────────────────────────────

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
// Domain models — activity log
// ─────────────────────────────────────────────────────────────────────────────

export type ActivityKind =
  | 'connect-start'
  | 'connect-ok'
  | 'connect-error'
  | 'disconnect'
  | 'transfer-start'
  | 'transfer-done'
  | 'transfer-error'
  | 'tail-start'
  | 'tail-end'
  | 'unzip-start'
  | 'unzip-done'
  | 'unzip-error'

export type ActivityLevel = 'info' | 'warn' | 'error'

/** One entry in the in-app activity log. Broadcast live and kept in a ring buffer. */
export interface ActivityEntry {
  id: string
  kind: ActivityKind
  level: ActivityLevel
  sessionId?: string
  message: string
  at: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — remote unzip
// ─────────────────────────────────────────────────────────────────────────────

/** Result of running `unzip` on the remote server. */
export interface UnzipResult {
  stdout: string
  stderr: string
  exitCode: number | null
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
  // sessions
  sessionOpen: 'session:open',
  sessionClose: 'session:close',
  // local filesystem
  fsLocalList: 'fs:local:list',
  fsLocalMkdir: 'fs:local:mkdir',
  fsLocalRename: 'fs:local:rename',
  fsLocalDelete: 'fs:local:delete',
  // remote filesystem (SFTP)
  fsRemoteList: 'fs:remote:list',
  fsRemoteMkdir: 'fs:remote:mkdir',
  fsRemoteRename: 'fs:remote:rename',
  fsRemoteDelete: 'fs:remote:delete',
  // transfers
  transferEnqueue: 'transfer:enqueue',
  transferCancel: 'transfer:cancel',
  // remote log tail
  tailStart: 'tail:start',
  tailStop: 'tail:stop',
  // remote unzip
  unzipRun: 'unzip:run',
  // activity log
  activityHistory: 'activity:history',
  // native dialogs
  dialogPickFile: 'dialog:pickFile',
  dialogPickFolder: 'dialog:pickFolder'
} as const

/** Union of every valid invoke channel string. */
export type InvokeChannel = (typeof INVOKE_CHANNELS)[keyof typeof INVOKE_CHANNELS]

// ─────────────────────────────────────────────────────────────────────────────
// Channels — push events (main → renderer)
// ─────────────────────────────────────────────────────────────────────────────

/** Channels the main process pushes to the renderer via `webContents.send`. */
export const EVENT_CHANNELS = {
  sessionStatus: 'session:status-change',
  transferEvent: 'transfer:event',
  tailLine: 'tail:line',
  tailNotice: 'tail:notice',
  tailEnd: 'tail:end',
  activityEvent: 'activity:event'
} as const

/** Union of every valid event channel string. */
export type EventChannel = (typeof EVENT_CHANNELS)[keyof typeof EVENT_CHANNELS]

/** Payload for the `session:status-change` channel. */
export interface SessionStatusEvent {
  sessionId: string
  status: SessionStatus
  message?: string
}
