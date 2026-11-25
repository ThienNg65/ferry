import type {
  CompanionCommandCard,
  CompanionReleaseHighlight,
  CompanionUiActionCard
} from '@shared/contract'
import { translatePlainEnglishCommandOffline } from './companionSnippets'
import { getReleasesSince, parseSemver } from './companionVersion'

export type CompanionActionId =
  | 'open-whats-new'
  | 'open-report-bug'
  | 'open-report-feature'
  | 'open-report-feedback'
  | 'open-settings'
  | 'open-history'
  | 'open-shortcuts'
  | 'open-command-palette'
  | 'open-file-filters'
  | 'open-dock-transfers'
  | 'open-dock-terminal'
  | 'open-dock-tail'
  | 'open-dock-monitor'
  | 'open-dock-activity'
  | 'open-external-releases'
  | 'show-help-topics'
  | 'start-tour'

export interface CompanionActionChip {
  id: CompanionActionId
  label: string
  icon?: string
  url?: string
}

export interface CompanionReply {
  text: string
  /** True when the reply is a generic fallback and an opt-in AI provider may enhance it. */
  isFallback?: boolean
  rootCause?: string
  commandCards?: CompanionCommandCard[]
  uiActionCards?: CompanionUiActionCard[]
  actions?: CompanionActionChip[]
  releaseCard?: {
    version: string
    title: string
    highlights: string[]
    url: string
    source: 'github' | 'bundled'
    previousVersion?: string | null
    moreCount?: number
  }
  openReportCategory?: 'bug' | 'feature' | 'feedback'
}

/**
 * Classifies common user-visible SSH/SFTP error messages into targeted,
 * non-destructive diagnostic checklists (documentation guidance only).
 */
export function diagnoseErrorText(errorText: string): string {
  const lower = errorText.toLowerCase()
  if (/publickey|keyboard-interactive|authentication failed|\bauth\b|\bpassphrase\b|\bssh key\b|\bprivate key\b/.test(lower)) {
    return 'Likely cause: rejected credentials or SSH key mismatch.\n1. Verify username, password/passphrase, or private key path in Site Settings.\n2. If using an SSH agent, confirm the key is loaded.'
  }
  if (/eacces|eperm|permission denied/.test(lower)) {
    return 'Likely cause: insufficient read/write permissions on the destination path.\n1. Check folder ownership and chmod permissions (right-click → Permissions).\n2. Verify the target directory is not read-only or mounted `ro`.\n3. Try uploading to your home directory or `/tmp` to confirm write access.'
  }
  if (/enospc|no space left|disk full|quota/.test(lower)) {
    return 'Likely cause: destination disk or user quota is full.\n1. Check free space in the Monitor dock tab or destination drive.\n2. Remove temporary files or choose a different target directory, then retry.'
  }
  if (/etimedout|timed out|econnreset|socket closed|broken pipe/.test(lower)) {
    return 'Likely cause: network drop, idle timeout, or firewall interruption.\n1. Check your network/VPN/proxy connection.\n2. Reconnect the tab and retry the transfer from the Transfers dock tab.'
  }
  if (/econnrefused|connection refused|enotfound|getaddrinfo/.test(lower)) {
    return 'Likely cause: unreachable host, wrong port, or SSH service not listening.\n1. Verify hostname, port (default 22), and any Proxy / Jump Host settings.\n2. Confirm the remote SSH daemon is running and reachable from this network.'
  }
  if (/host key|fingerprint|known_hosts|mismatch/.test(lower)) {
    return 'Likely cause: the server presented a different SSH host key than previously trusted.\n1. Confirm with your server admin whether the host was rebuilt or rotated keys.\n2. You can review or forget saved fingerprints in Settings → Privacy & Legal → Trusted SSH Hosts.'
  }
  if (/enoent|no such file|broken symlink/.test(lower)) {
    return 'Likely cause: the source or target path no longer exists (or is a broken symlink).\n1. Refresh the file pane (`Ctrl+R`) to confirm the file/folder is still present.\n2. Check whether a parent directory was moved or renamed.'
  }
  return 'General troubleshooting steps (documentation guidance — no remote commands are run):\n1. Check the Transfers tab for the exact error and retry or reconnect.\n2. Verify write permissions and free disk space on the destination.\n3. Confirm the remote path still exists and is not a broken symlink.'
}

export interface CompanionQueryContext {
  currentVersion: string
  previousVersion: string | null
  releases: readonly CompanionReleaseHighlight[]
  offlineFallback: boolean
  isConnected: boolean
  lastTransferError?: string | null
}

function buildWhatsNewReply(ctx: CompanionQueryContext, askDiff: boolean): CompanionReply {
  const version = ctx.currentVersion || 'current'
  if (askDiff && ctx.previousVersion && parseSemver(ctx.previousVersion)) {
    const diffReleases = getReleasesSince(ctx.releases, ctx.previousVersion, ctx.currentVersion)
    if (diffReleases.length > 0) {
      const mergedHighlights = diffReleases.flatMap((r) =>
        r.highlights.map((h) => (diffReleases.length > 1 ? `v${r.version}: ${h}` : h))
      ).slice(0, 8)
      const latest = diffReleases[0]
      return {
        text: `Here is what changed between v${ctx.previousVersion} and v${version}${ctx.offlineFallback ? ' (from bundled offline notes)' : ''}:`,
        releaseCard: {
          version,
          title: `Changes since v${ctx.previousVersion}`,
          highlights: mergedHighlights.length > 0 ? mergedHighlights : ['Maintenance and stability improvements.'],
          url: latest.url,
          source: latest.source,
          previousVersion: ctx.previousVersion,
          moreCount: Math.max(0, diffReleases.length - 1)
        },
        actions: [
          { id: 'open-external-releases', label: 'Full release notes', icon: 'i-lucide-external-link', url: latest.url },
          { id: 'show-help-topics', label: 'Explore features', icon: 'i-lucide-compass' }
        ]
      }
    }
    return {
      text: `I don't have release notes between v${ctx.previousVersion} and v${version} locally right now. You can view the full official changelog on GitHub.`,
      actions: [
        {
          id: 'open-external-releases',
          label: 'Full release notes',
          icon: 'i-lucide-external-link',
          url: 'https://github.com/ThienNg65/ferry-release/releases'
        }
      ]
    }
  }

  const exact = ctx.releases.find((r) => r.version === ctx.currentVersion) ?? ctx.releases[0]
  if (!exact) {
    return {
      text: `You're running Ferry v${version}, but release notes aren't available offline right now. You can open the official release channel when you're back online.`,
      actions: [
        {
          id: 'open-external-releases',
          label: 'Open ferry-release',
          icon: 'i-lucide-external-link',
          url: 'https://github.com/ThienNg65/ferry-release/releases'
        }
      ]
    }
  }

  return {
    text:
      exact.version === ctx.currentVersion
        ? `Here's what's new in Ferry v${exact.version}${ctx.offlineFallback ? ' (offline notes)' : ''}:`
        : `You're on Ferry v${version}. The latest available release notes are for v${exact.version}:`,
    releaseCard: {
      version: exact.version,
      title: exact.title,
      highlights: exact.highlights.length > 0 ? exact.highlights : ['Stability and bug-fix improvements.'],
      url: exact.url,
      source: exact.source
    },
    actions: [
      { id: 'open-external-releases', label: 'Full release notes', icon: 'i-lucide-external-link', url: exact.url },
      { id: 'show-help-topics', label: 'Show me around', icon: 'i-lucide-compass' }
    ]
  }
}

export function answerCompanionQuery(rawInput: string, ctx: CompanionQueryContext): CompanionReply {
  const q = rawInput.trim().toLowerCase()

  if (!q) {
    return {
      text: 'I can help you navigate Ferry without leaving your workspace. Start the 4-step interactive tour or jump directly to a feature below:',
      actions: [
        { id: 'start-tour', label: 'Start 4-step tour', icon: 'i-lucide-map' },
        { id: 'open-file-filters', label: 'Open File Filters', icon: 'i-lucide-filter' },
        { id: 'open-history', label: 'Show Transfer History', icon: 'i-lucide-history' },
        { id: 'open-dock-terminal', label: 'Open Terminal', icon: 'i-lucide-terminal' },
        { id: 'open-dock-tail', label: 'Open Log Tail', icon: 'i-lucide-scroll-text' },
        { id: 'open-shortcuts', label: 'Keyboard Shortcuts', icon: 'i-lucide-keyboard' },
        { id: 'open-settings', label: 'Open Settings', icon: 'i-lucide-settings' }
      ]
    }
  }

  if (/\b(what'?s new|whats new|changed since|changelog|release notes|new version|updated)\b/.test(q)) {
    const askDiff = /\b(since|diff|changed since|previous|last version)\b/.test(q)
    return buildWhatsNewReply(ctx, askDiff)
  }

  if (/\b(pre-?flight|folder sync|mirror mode|deleteextras)\b/i.test(q) || /\bsync\b.*\b(warning|delete|push|pull)\b/i.test(q)) {
    return {
      text: 'Folder Sync Pre-Flight checks warn before mirror mode deletes destination files, uploads sensitive credential files (`.env`, private keys), or pushes to a nearly full disk.\n1. Review the **Preview** deletion list carefully — mirror deletions cannot be undone.\n2. Exclude `.env` or key files if you do not intend to deploy secrets.\n3. Check free space in the Monitor dock tab if a disk warning appears.',
      actions: [
        { id: 'open-dock-monitor', label: 'Open Monitor', icon: 'i-lucide-activity' },
        { id: 'open-file-filters', label: 'Open File Filters', icon: 'i-lucide-filter' }
      ]
    }
  }

  const isErrorOrTransferQuery = /\b(transfers?|uploads?|downloads?|queue|failed|errors?|troubleshoot|permission denied|eacces|eperm|enospc|etimedout|econnreset|econnrefused|enoent|publickey|broken pipe|timeouts?|disk full|host key|refused|symlinks?)\b/.test(q)
  if (isErrorOrTransferQuery) {
    const combined = `${rawInput} ${ctx.lastTransferError ?? ''}`.trim()
    const diagnosis = diagnoseErrorText(combined)
    const errorHeader = ctx.lastTransferError
      ? `Observed transfer error: "${ctx.lastTransferError}"\n\n`
      : ''
    return {
      text: `${errorHeader}${diagnosis}`,
      actions: [
        { id: 'open-dock-transfers', label: 'Open Transfers', icon: 'i-lucide-arrow-up-down' },
        { id: 'open-history', label: 'Show Transfer History', icon: 'i-lucide-history' },
        { id: 'open-report-bug', label: 'Report a problem', icon: 'i-lucide-bug' }
      ]
    }
  }

  if (/\b(report|bug|issue|broken|crash)\b/.test(q)) {
    return {
      text: 'I can help you draft a structured bug report with automatic secret & path redaction before you review and submit it on GitHub.',
      openReportCategory: 'bug',
      actions: [{ id: 'open-report-bug', label: 'Draft bug report', icon: 'i-lucide-bug' }]
    }
  }

  if (/\b(suggest|feature request|idea|feedback)\b/.test(q)) {
    const isFeature = /\b(suggest|feature|idea)\b/.test(q)
    return {
      text: isFeature
        ? 'Love hearing ideas! Use the guided form below to draft a feature suggestion for the public Ferry tracker.'
        : 'Use the guided form below to share feedback with the Ferry maintainers.',
      openReportCategory: isFeature ? 'feature' : 'feedback',
      actions: [
        {
          id: isFeature ? 'open-report-feature' : 'open-report-feedback',
          label: isFeature ? 'Suggest a feature' : 'Send feedback',
          icon: 'i-lucide-message-square-plus'
        }
      ]
    }
  }

  if (/\b(filters?|visibility|hidden|globs?|exclude|include)\b/.test(q)) {
    return {
      text: 'File Visibility Filters let you include or exclude filenames by glob pattern (like `*.log` or `node_modules`) per pane without deleting anything on disk.',
      actions: [
        { id: 'open-file-filters', label: 'Open File Filters', icon: 'i-lucide-filter' },
        { id: 'open-shortcuts', label: 'Keyboard Shortcuts', icon: 'i-lucide-keyboard' }
      ]
    }
  }

  const commandMatch = translatePlainEnglishCommandOffline(rawInput)
  if (commandMatch) {
    return {
      isFallback: true,
      text: commandMatch.summary,
      commandCards: commandMatch.commandCards,
      uiActionCards: commandMatch.uiActionCards,
      actions: [{ id: 'open-dock-terminal', label: 'Open Terminal', icon: 'i-lucide-terminal' }]
    }
  }

  if (/\b(terminal|ssh|shell|console|xterm)\b/.test(q)) {
    return {
      text: 'Press `Ctrl+\`` while connected to toggle the embedded SSH terminal in the dock. Your session and scrollback stay alive even when you switch dock tabs or collapse the dock.',
      actions: [
        { id: 'open-dock-terminal', label: 'Open Terminal', icon: 'i-lucide-terminal' },
        { id: 'open-settings', label: 'Terminal Settings', icon: 'i-lucide-settings' }
      ]
    }
  }

  if (/\b(tails?|logs?|streams?)\b/.test(q)) {
    return {
      text: 'Right-click any log or text file in the Remote pane and choose "Tail this file live" to stream lines in real time with search and keyword highlighting.',
      actions: [{ id: 'open-dock-tail', label: 'Open Log Tail', icon: 'i-lucide-scroll-text' }]
    }
  }

  if (/\b(monitor|cpu|memory|ram|process|disk)\b/.test(q)) {
    return {
      text: 'The Monitor dock tab displays live remote CPU, memory, and process metrics for the active SSH session.',
      actions: [{ id: 'open-dock-monitor', label: 'Open Monitor', icon: 'i-lucide-activity' }]
    }
  }

  if (/\b(glass|theme|dark|light|appearance|settings|dock|proxy|shortcut|keybind)\b/.test(q)) {
    return {
      text: 'You can customize theme, accent color, Modern Glass UI, dock position (bottom/right), proxy, and privacy settings in Settings, or press `?` for all keyboard shortcuts.',
      actions: [
        { id: 'open-settings', label: 'Open Settings', icon: 'i-lucide-settings' },
        { id: 'open-shortcuts', label: 'Keyboard Shortcuts', icon: 'i-lucide-keyboard' },
        { id: 'open-command-palette', label: 'Command Palette', icon: 'i-lucide-search' }
      ]
    }
  }

  if (/\b(help|how do i use|tour|show me around|features|guide)\b/.test(q)) {
    return {
      text: 'I can help you navigate Ferry without leaving your workspace. Start the 4-step interactive tour or jump directly to a feature below:',
      actions: [
        { id: 'start-tour', label: 'Start 4-step tour', icon: 'i-lucide-map' },
        { id: 'open-file-filters', label: 'Open File Filters', icon: 'i-lucide-filter' },
        { id: 'open-history', label: 'Show Transfer History', icon: 'i-lucide-history' },
        { id: 'open-dock-terminal', label: 'Open Terminal', icon: 'i-lucide-terminal' },
        { id: 'open-dock-tail', label: 'Open Log Tail', icon: 'i-lucide-scroll-text' },
        { id: 'open-shortcuts', label: 'Keyboard Shortcuts', icon: 'i-lucide-keyboard' },
        { id: 'open-settings', label: 'Open Settings', icon: 'i-lucide-settings' }
      ]
    }
  }

  return {
    isFallback: true,
    text: "I'm not sure I have a specific answer for that yet — I run locally without a cloud AI model. I can still show what's new, walk you through Ferry, or help you report a bug.",
    actions: [
      { id: 'open-whats-new', label: "Discover what's new", icon: 'i-lucide-sparkles' },
      { id: 'start-tour', label: 'Start 4-step tour', icon: 'i-lucide-map' },
      { id: 'open-report-bug', label: 'Report a problem', icon: 'i-lucide-bug' }
    ]
  }
}
