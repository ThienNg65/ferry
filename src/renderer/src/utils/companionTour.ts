import type { CompanionActionChip } from './companionEngine'

export interface CompanionTourStep {
  id: string
  title: string
  body: string
  tip: string
  action?: CompanionActionChip
}

export const COMPANION_TOUR_STEPS: readonly CompanionTourStep[] = [
  {
    id: 'sites',
    title: 'Connect & organize sites',
    body: 'Save frequent SFTP/SSH servers with environments, jump hosts, or SSH keys — or use Quick Connect for one-off sessions.',
    tip: 'Press Ctrl+Tab to switch between multiple open server tabs without losing your place.',
    action: { id: 'open-command-palette', label: 'Try Command Palette (Ctrl+K)', icon: 'i-lucide-search' }
  },
  {
    id: 'files',
    title: 'Browse & filter files fast',
    body: 'Compare Local and Remote panes side-by-side, drag-and-drop to transfer, and use File Visibility Filters to hide noisy build folders or focus on specific extensions.',
    tip: 'File filters only change what you see — they never delete or modify files.',
    action: { id: 'open-file-filters', label: 'Open File Filters', icon: 'i-lucide-filter' }
  },
  {
    id: 'dock',
    title: 'Transfers, Log Tail & Terminal',
    body: 'The collapsible dock (Bottom or Right) keeps Transfers, live remote Log Tailing, Resource Monitor, and an embedded SSH Terminal right beneath your files.',
    tip: 'Press Ctrl+` anytime while connected to toggle the terminal without losing scrollback.',
    action: { id: 'open-dock-terminal', label: 'Open Terminal', icon: 'i-lucide-terminal' }
  },
  {
    id: 'companion',
    title: 'Stay in control with Companion',
    body: "Open Ferry Companion anytime with Ctrl+Space or the top-bar icon to check What's New, troubleshoot errors, or draft privacy-redacted bug reports.",
    tip: 'Turn on Quiet Mode or hide the dock avatar anytime in Preferences or Settings → Appearance.',
    action: { id: 'open-settings', label: 'Open Settings', icon: 'i-lucide-settings' }
  }
]
