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
  | 'ARCHIVE_TOOL_NOT_FOUND'
  | 'AUTH'
  | 'HOST_KEY_MISMATCH'

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

/** Supported authentication methods. `agent` delegates to a running ssh-agent/Pageant/Windows OpenSSH Agent — no secret stored by Ferry at all. */
export type AuthMethod = 'password' | 'privateKey' | 'agent'

/**
 * A saved jump-host (bastion) hop — the SSH connection tunnels through this
 * host before reaching the real target. Only password/private-key auth are
 * supported for the hop itself (not agent, not a further nested jump host) —
 * a deliberate scope limit, not an oversight.
 */
export interface JumpHostConfig {
  host: string
  port: number
  username: string
  authMethod: 'password' | 'privateKey'
  privateKeyPath?: string
  password?: string
  passphrase?: string
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
  jumpHost?: JumpHostInfo
  /** Free-text group/folder name for organizing the site list — undefined means ungrouped. */
  group?: string
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
  jumpHost?: JumpHostConfig
  group?: string
}

/** An ad-hoc (not saved) connection profile used for quick-connect. */
export interface QuickConnectInput extends SiteInput {}

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
  source: 'winscp' | 'putty'
  name: string
  host: string
  port: number
  username: string
  privateKeyPath?: string
  remoteInitialPath?: string
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

/** Request payload for `session:keyboard-interactive-respond`. */
export interface KeyboardInteractiveRespondRequest {
  requestId: string
  /** Must be the same length as the originating event's `prompts`. */
  responses: string[]
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

/** Result of reading a text file's content for preview — capped, never the full file for huge logs. */
export interface FileReadResult {
  path: string
  content: string
  truncated: boolean
  size: number
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
// Domain models — long-running operations (Activity dock tab)
// ─────────────────────────────────────────────────────────────────────────────

export type OperationKind =
  | 'extract-remote'
  | 'compress-remote'
  | 'compress-local'
  | 'delete-remote'
  | 'delete-remote-batch'

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
}

/** Result of `fs:remote:deleteMany` — per-path outcomes so the renderer patches its listing once. */
export interface DeleteManyResult {
  deletedPaths: string[]
  failures: { path: string; error: string }[]
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
// Domain models — terminal
// ─────────────────────────────────────────────────────────────────────────────

/** Result of opening an interactive SSH shell (PTY) for a session. */
export interface TerminalOpenResult {
  terminalId: string
}

/** Payload for the `terminal:data` channel — raw output bytes from the remote shell. */
export interface TerminalDataEvent {
  terminalId: string
  data: Uint8Array
}

/** Payload for the `terminal:exit` channel. */
export interface TerminalExitEvent {
  terminalId: string
  exitCode: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — remote resource monitor
// ─────────────────────────────────────────────────────────────────────────────

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
  loadAvg: [number, number, number]
  uptimeSec: number
}

export type MonitorStatus = 'started' | 'stopped' | 'unsupported' | 'error'

/** Push-event payload for the `monitor:status` channel. */
export interface MonitorStatusEvent {
  sessionId: string
  state: MonitorStatus
  message?: string
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain models — window chrome
// ─────────────────────────────────────────────────────────────────────────────

/** Payload for the `window:state-change` channel. */
export interface WindowStateEvent {
  isMaximized: boolean
}

/** Result of querying the current window's maximized state. */
export interface WindowIsMaximizedResult {
  isMaximized: boolean
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
  // app settings
  settingsGet: 'settings:get',
  settingsSetOpenTabs: 'settings:setOpenTabs',
  settingsSetBandwidthLimit: 'settings:setBandwidthLimit',
  // sessions
  sessionOpen: 'session:open',
  sessionClose: 'session:close',
  sessionKeyboardInteractiveRespond: 'session:keyboard-interactive-respond',
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
  fsRemoteDeleteMany: 'fs:remote:deleteMany',
  fsRemoteChmod: 'fs:remote:chmod',
  fsLocalReadFile: 'fs:local:readFile',
  fsRemoteReadFile: 'fs:remote:readFile',
  // transfers
  transferEnqueue: 'transfer:enqueue',
  transferCancel: 'transfer:cancel',
  // remote log tail
  tailStart: 'tail:start',
  tailStop: 'tail:stop',
  // terminal
  terminalOpen: 'terminal:open',
  terminalWrite: 'terminal:write',
  terminalResize: 'terminal:resize',
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
  // native dialogs
  dialogPickFile: 'dialog:pickFile',
  dialogPickFolder: 'dialog:pickFolder',
  // system paths
  systemGetDownloadsPath: 'system:getDownloadsPath',
  systemGetAppVersion: 'system:getAppVersion',
  systemStartDrag: 'system:startDrag',
  systemClipboardReadText: 'system:clipboardReadText',
  // window chrome
  windowMinimize: 'window:minimize',
  windowMaximizeToggle: 'window:maximizeToggle',
  windowClose: 'window:close',
  windowIsMaximized: 'window:isMaximized',
  // auto-update
  updateInstallNow: 'update:installNow'
} as const

/** Union of every valid invoke channel string. */
export type InvokeChannel = (typeof INVOKE_CHANNELS)[keyof typeof INVOKE_CHANNELS]

// ─────────────────────────────────────────────────────────────────────────────
// Channels — push events (main → renderer)
// ─────────────────────────────────────────────────────────────────────────────

/** Channels the main process pushes to the renderer via `webContents.send`. */
export const EVENT_CHANNELS = {
  sessionStatus: 'session:status-change',
  keyboardInteractivePrompt: 'session:keyboard-interactive-prompt',
  transferEvent: 'transfer:event',
  operationEvent: 'operation:event',
  monitorSample: 'monitor:sample',
  monitorStatus: 'monitor:status',
  tailLine: 'tail:line',
  tailNotice: 'tail:notice',
  tailEnd: 'tail:end',
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit',
  windowStateChange: 'window:state-change',
  updateAvailable: 'update:available',
  updateDownloaded: 'update:downloaded'
} as const

/** Union of every valid event channel string. */
export type EventChannel = (typeof EVENT_CHANNELS)[keyof typeof EVENT_CHANNELS]

/** Payload for the `session:status-change` channel. */
export interface SessionStatusEvent {
  sessionId: string
  status: SessionStatus
  message?: string
}
