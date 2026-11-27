import {
  classifyCommandRisk,
  escalateCommandRisk,
  type CompanionCommandCard,
  type CompanionCommandRisk,
  type CompanionStructuredOutput,
  type CompanionUiActionCard
} from '@shared/contract'

export { classifyCommandRisk, escalateCommandRisk }

export interface CompanionSnippet {
  id: string
  label: string
  command: string
  description: string
  risk: CompanionCommandRisk
  builtIn?: boolean
}

export interface CompanionCommandHistoryEntry {
  id: string
  command: string
  risk: CompanionCommandRisk
  executedAt: string
  hostLabel?: string | null
}

export const BUILT_IN_SNIPPETS: readonly CompanionSnippet[] = [
  {
    id: 'builtin-disk-free',
    label: 'Check disk usage',
    command: 'df -h',
    description: 'Show mounted filesystems and available disk space.',
    risk: 'read_only',
    builtIn: true
  },
  {
    id: 'builtin-dir-sizes',
    label: 'Largest folders in current path',
    command: 'du -sh * 2>/dev/null | sort -h || du -sk * 2>/dev/null | sort -rn',
    description: 'Summarize disk usage for items in the current directory.',
    risk: 'read_only',
    builtIn: true
  },
  {
    id: 'builtin-open-ports',
    label: 'Listening TCP/UDP ports',
    command: 'ss -tulpn 2>/dev/null || netstat -tulpn',
    description: 'List active listening sockets and owning processes.',
    risk: 'read_only',
    builtIn: true
  },
  {
    id: 'builtin-top-memory',
    label: 'Top memory processes',
    command: '{ ps aux --sort=-%mem 2>/dev/null || ps aux; } | head -n 15',
    description: 'Show top 15 processes sorted by memory usage.',
    risk: 'read_only',
    builtIn: true
  },
  {
    id: 'builtin-journal-errors',
    label: 'Recent system errors',
    command: 'journalctl -p err -n 50 --no-pager 2>/dev/null || tail -n 50 /var/log/syslog /var/log/messages 2>/dev/null',
    description: 'Inspect the latest 50 error-level system log entries.',
    risk: 'read_only',
    builtIn: true
  },
  {
    id: 'builtin-failed-units',
    label: 'Failed services / units',
    command: 'systemctl --failed --no-pager 2>/dev/null || rc-status 2>/dev/null || service --status-all 2>/dev/null',
    description: 'Check whether any system services are currently in a failed state.',
    risk: 'read_only',
    builtIn: true
  }
]

const COMMAND_TRANSLATIONS: Array<{
  pattern: RegExp
  summary: string
  cards: Array<{ command: string; description: string }>
}> = [
  {
    pattern: /\b(disk\s*(usage|space)|free\s*space|how\s*full|largest\s*(files?|folders?|dirs?)|big\s*files?)\b/i,
    summary: 'Here are read-only commands to inspect filesystem space and locate large directories or files:',
    cards: [
      { command: 'df -h', description: 'Check overall mounted filesystem space' },
      { command: '{ du -sh * 2>/dev/null | sort -h || du -sk * 2>/dev/null | sort -rn; } | tail -n 15', description: 'Rank largest entries in current directory' },
      { command: 'find . -maxdepth 3 -type f -size +50M -ls 2>/dev/null', description: 'Find files larger than 50 MB within 3 levels' }
    ]
  },
  {
    pattern: /\b(ports?|listening|sockets?|what('?s| is)\s*running\s*on\s*port)\b/i,
    summary: 'Use `ss` (with `netstat`/`lsof` fallbacks) to inspect active listening ports and their processes:',
    cards: [
      { command: 'ss -tulpn 2>/dev/null || netstat -tulpn', description: 'List all listening TCP/UDP ports and PIDs' },
      { command: 'lsof -i -P -n 2>/dev/null | grep LISTEN', description: 'Fallback port listing via lsof' }
    ]
  },
  {
    pattern: /\b(cpu|memory|ram|swap|high\s*load|top\s*process(es)?|hogging|slow\s*server)\b/i,
    summary: 'Inspect CPU, memory, and top resource-consuming processes without modifying server state:',
    cards: [
      { command: 'free -h 2>/dev/null || free -m', description: 'Check RAM, buffers/cache, and swap usage' },
      { command: '{ ps aux --sort=-%cpu 2>/dev/null || ps aux; } | head -n 15', description: 'Top 15 processes by CPU usage' },
      { command: '{ ps aux --sort=-%mem 2>/dev/null || ps aux; } | head -n 15', description: 'Top 15 processes by RAM usage' }
    ]
  },
  {
    pattern: /\b(systemd|services?|daemon|failed\s*units?|journalctl)\b/i,
    summary: 'Check service health and recent system error logs:',
    cards: [
      { command: 'systemctl --failed --no-pager 2>/dev/null || rc-status 2>/dev/null || service --status-all 2>/dev/null', description: 'List failed or active services' },
      { command: 'journalctl -p err -n 50 --no-pager 2>/dev/null || tail -n 50 /var/log/syslog /var/log/messages 2>/dev/null', description: 'Show last 50 system error entries' }
    ]
  },
  {
    pattern: /\b(docker|containers?)\b/i,
    summary: 'Inspect running Docker containers and resource consumption:',
    cards: [
      { command: 'docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"', description: 'List containers, statuses, and exposed ports' },
      { command: 'docker stats --no-stream', description: 'Capture a one-shot CPU/memory snapshot per container' }
    ]
  },
  {
    pattern: /\b(permissions?|chmod|chown|owner(ship)?)\b/i,
    summary: 'Inspect file permissions and ownership before making changes:',
    cards: [
      { command: 'ls -la', description: 'Show permissions, owner, group, and sizes in current folder' },
      { command: 'namei -l . 2>/dev/null || ls -ld .', description: 'Inspect directory permissions along the full path' }
    ]
  },
  {
    pattern: /\b(search|grep|find\s*(in|inside|text|pattern))\b/i,
    summary: 'Search recursively for text patterns across files:',
    cards: [
      { command: 'grep -rnE "ERROR|WARN|Exception" . --include="*.log" | head -n 40', description: 'Search for error lines in .log files' }
    ]
  }
]

const EXPLICIT_COMMAND_INTENT_RE =
  /\b(command\s+(to|for)|bash\s+command|shell\s+command|linux\s+command|cli\s+for|how\s+do\s+i\s+(check|find|list|see|inspect|view|restart|kill|search)|show\s+me\s+(the\s+)?command)\b/i

export function translatePlainEnglishCommandOffline(query: string): {
  summary: string
  commandCards: CompanionCommandCard[]
  uiActionCards?: CompanionUiActionCard[]
} | null {
  const trimmed = query.trim()
  if (!trimmed) return null

  for (const rule of COMMAND_TRANSLATIONS) {
    if (rule.pattern.test(trimmed) && (EXPLICIT_COMMAND_INTENT_RE.test(trimmed) || trimmed.split(/\s+/).length <= 8)) {
      return {
        summary: rule.summary,
        commandCards: rule.cards.map((c) => ({
          command: c.command,
          description: c.description,
          risk: classifyCommandRisk(c.command)
        }))
      }
    }
  }
  return null
}

export function diagnoseLogSnippetOffline(
  logPath: string,
  snippet: string,
  actionRemotePath?: string
): CompanionStructuredOutput {
  const lower = snippet.toLowerCase()
  const commandCards: CompanionCommandCard[] = []
  const uiActionCards: CompanionUiActionCard[] = []
  const resolvedPath = (actionRemotePath ?? (logPath && logPath !== '[REDACTED_PATH]' ? logPath : '')).trim()

  if (resolvedPath) {
    uiActionCards.push({ kind: 'tail-log', remotePath: resolvedPath, label: 'Focus Log Tail' })
  }

  let rootCause = 'Inspect surrounding log lines and service journal for preceding errors.'
  let summary = `Analyzed log excerpt from ${logPath || 'active stream'}.`

  if (/enospc|no space left|disk full/.test(lower)) {
    rootCause = 'The remote filesystem ran out of free disk space or inodes.'
    summary = 'This log indicates disk exhaustion (ENOSPC). Free space or rotate oversized logs before retrying writes.'
    commandCards.push(
      { command: 'df -h && df -i', description: 'Check available disk blocks and inodes', risk: 'read_only' },
      { command: '{ du -sh /var/log/* 2>/dev/null | sort -h || du -sk /var/log/* 2>/dev/null | sort -rn; } | tail -n 10', description: 'Find largest files under /var/log', risk: 'read_only' }
    )
  } else if (/out of memory|oom-killer|killed process|java\.lang\.outofmemoryerror|heap out of memory/.test(lower)) {
    rootCause = 'Process memory limit exceeded or kernel OOM killer terminated a worker.'
    summary = 'The log shows an Out-Of-Memory event. Verify system RAM, swap, and which process allocated the most memory.'
    commandCards.push(
      { command: 'free -h 2>/dev/null || free -m', description: 'Check available RAM and swap space', risk: 'read_only' },
      { command: '{ dmesg -T 2>/dev/null || dmesg 2>/dev/null; } | grep -i -E "oom|killed process" | tail -n 20', description: 'Inspect kernel OOM killer records', risk: 'read_only' }
    )
  } else if (/econnrefused|connection refused|upstream.*failed|502 bad gateway|504 gateway/.test(lower)) {
    rootCause = 'Reverse proxy or client could not connect to the upstream backend socket/port.'
    summary = 'Upstream connection failed or timed out. Verify the backend service is running and listening on the expected port.'
    commandCards.push(
      { command: 'ss -tulpn 2>/dev/null || netstat -tulpn', description: 'Confirm which services are listening on ports', risk: 'read_only' },
      { command: 'systemctl --failed --no-pager 2>/dev/null || rc-status 2>/dev/null || service --status-all 2>/dev/null', description: 'Check for crashed or failed services', risk: 'read_only' }
    )
  } else if (/eacces|eperm|permission denied/.test(lower)) {
    rootCause = 'The service or SSH user lacks filesystem read/write/execute permissions on the target path.'
    summary = 'Permission denied while accessing a file or socket. Check ownership and POSIX permissions.'
    commandCards.push({
      command: resolvedPath ? `ls -la '${resolvedPath.replace(/'/g, `'\\''`)}'` : 'ls -la',
      description: 'Inspect file ownership and permissions',
      risk: 'read_only'
    })
  } else if (/ssl|tls|certificate|x509|expired/.test(lower)) {
    rootCause = 'TLS handshake or certificate validation failed (expired, mismatched hostname, or missing chain).'
    summary = 'Detected a TLS/certificate error in the log. Check certificate dates and proxy config.'
    commandCards.push({
      command: 'journalctl -p err -n 40 --no-pager 2>/dev/null || tail -n 40 /var/log/syslog /var/log/messages 2>/dev/null',
      description: 'Review recent service TLS/startup errors',
      risk: 'read_only'
    })
  } else {
    commandCards.push({
      command: 'journalctl -p err -n 40 --no-pager 2>/dev/null || tail -n 40 /var/log/syslog /var/log/messages 2>/dev/null',
      description: 'Check correlated system error logs',
      risk: 'read_only'
    })
  }

  return {
    summary,
    rootCause,
    commandCards,
    uiActionCards: uiActionCards.length > 0 ? uiActionCards : undefined
  }
}

export interface MonitorSpikeSummaryInput {
  cpuPct: number | null
  memPct: number
  swapPct: number
  diskPct: number | null
  loadAvg: [number, number, number]
  coreCount: number
  topProcesses: Array<{ pid: number; name: string; cpuPct: number | null; rssMB: number }>
}

export function diagnoseMonitorSpikeOffline(input: MonitorSpikeSummaryInput): CompanionStructuredOutput {
  const issues: string[] = []
  const commandCards: CompanionCommandCard[] = []

  if (input.cpuPct !== null && input.cpuPct >= 80) {
    issues.push(`high CPU (${input.cpuPct.toFixed(1)}%)`)
  }
  if (input.loadAvg[0] >= Math.max(1, input.coreCount)) {
    issues.push(`elevated 1m load (${input.loadAvg[0].toFixed(2)} on ${input.coreCount} cores)`)
  }
  if (input.memPct >= 85) {
    issues.push(`high memory usage (${input.memPct}%)`)
  }
  if (input.swapPct >= 50) {
    issues.push(`heavy swap pressure (${input.swapPct}%)`)
  }
  if (input.diskPct !== null && input.diskPct >= 90) {
    issues.push(`critical root disk usage (${input.diskPct}%)`)
  }

  const top = input.topProcesses[0]
  const topLine = top
    ? `Top process: ${top.name} (PID ${top.pid}, ${top.cpuPct !== null ? `${top.cpuPct.toFixed(1)}% CPU, ` : ''}${top.rssMB} MB RSS).`
    : 'No process breakdown available yet.'

  if (top) {
    commandCards.push({
      command: `ps -p ${top.pid} -o pid,ppid,user,%cpu,%mem,etime,cmd 2>/dev/null || ps aux | grep -E "PID|${top.pid}"`,
      description: `Inspect full command line and runtime of ${top.name} (PID ${top.pid})`,
      risk: 'read_only'
    })
  }
  if (input.diskPct !== null && input.diskPct >= 90) {
    commandCards.push({
      command: 'df -h && { du -sh /var/log/* /tmp/* 2>/dev/null | sort -h || du -sk /var/log/* /tmp/* 2>/dev/null | sort -rn; } | tail -n 15',
      description: 'Locate directories consuming disk space on /',
      risk: 'read_only'
    })
  }
  if (input.memPct >= 85 || input.swapPct >= 50) {
    commandCards.push({
      command: '{ free -h 2>/dev/null || free -m; } && { ps aux --sort=-%mem 2>/dev/null || ps aux; } | head -n 15',
      description: 'Inspect memory/swap pressure and top RSS consumers',
      risk: 'read_only'
    })
  }
  if (commandCards.length === 0) {
    commandCards.push({
      command: '{ vmstat 1 3 2>/dev/null || uptime; } && { ps aux --sort=-%cpu 2>/dev/null || ps aux; } | head -n 12',
      description: 'Sample CPU wait/context switches and top processes',
      risk: 'read_only'
    })
  }

  const summary =
    issues.length > 0
      ? `Detected ${issues.join(', ')}. ${topLine}`
      : `Resource snapshot looks healthy (CPU ${input.cpuPct?.toFixed(1) ?? 'N/A'}%, RAM ${input.memPct}%). ${topLine}`

  const rootCause =
    issues.length > 0
      ? `Primary pressure signals: ${issues.join('; ')}. ${topLine}`
      : 'No active threshold breach detected; inspect top process trends if latency is reported.'

  return {
    summary,
    rootCause,
    commandCards: commandCards.slice(0, 4)
  }
}
