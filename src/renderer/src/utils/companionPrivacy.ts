export type IssueCategory = 'bug' | 'feature' | 'feedback'

export interface IssueDraftForm {
  category: IssueCategory
  title: string
  details: string
  expected: string
  actual: string
  includeDiagnostics: boolean
}

export interface SafeDiagnostics {
  appVersion: string
  platform: string
  dockPosition?: string
  theme?: string
  lastErrorSummary?: string | null
}

export type RedactionMode = 'strict' | 'diagnostic'

export interface RedactOptions {
  mode?: RedactionMode
}

export interface RedactionResult {
  text: string
  redactionCount: number
  categories: string[]
}

export interface BuiltIssueDraft {
  url: string
  markdown: string
  title: string
  labels: string[]
  redactionCount: number
  redactedCategories: string[]
  truncatedForUrl: boolean
}

export const PUBLIC_ISSUE_TRACKER_URL = 'https://github.com/ThienNg65/ferry-release/issues/new'
const MAX_SAFE_URL_LENGTH = 6_000

interface RedactionRule {
  label: string
  pattern: RegExp
  replacement: string
  /** When true, only applied in `'strict'` mode (skipped in `'diagnostic'` mode). */
  strictOnly?: boolean
  /** Optional predicate to skip redacting a specific match in `'diagnostic'` mode. */
  skipInDiagnostic?: (match: string) => boolean
}

const SAFE_DIAGNOSTIC_PATH_RE = /^["']?\/(?:var\/log|etc|config)(?:\/|$)/

const REDACTION_RULES: RedactionRule[] = [
  {
    label: 'private key',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----|[\s\S]*)/g,
    replacement: '[REDACTED_PRIVATE_KEY]'
  },
  {
    label: 'auth token',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{16,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b|\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b|\bAIza[0-9A-Za-z_-]{30,}\b|\bxox[a-z]-[A-Za-z0-9-]{10,}\b|\bya29\.[A-Za-z0-9_-]{20,}\b|\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g,
    replacement: '[REDACTED_TOKEN]'
  },
  {
    label: 'bearer header',
    pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}(?=\s|$|['",;])/gi,
    replacement: '$1 [REDACTED]'
  },
  {
    label: 'credential',
    pattern: /(?<![A-Za-z0-9])(["']?[A-Za-z0-9_-]*(?:password|passwd|passphrase|secret|token|api[_-]?key|authorization|(?:^|_)pass(?:_[A-Za-z0-9_-]*)?)[A-Za-z0-9_-]*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    replacement: '$1[REDACTED]'
  },
  {
    label: 'credential',
    pattern: /(?<![A-Za-z0-9_-])(--?(?:[A-Za-z0-9_-]*(?:password|passwd|passphrase|secret|token|api[-_]?key|auth[-_]?key|credential)|pass(?:[-_][A-Za-z0-9_-]*)?)\s+)(?!--)(?:"[^"]*"|'[^']*'|[^\s,;"']+)/gi,
    replacement: '$1[REDACTED]'
  },
  {
    label: 'credential',
    pattern: /(?<![A-Za-z0-9_-])(-u\s+[^\s:'"\\]+:)(?:"[^"]*"|'[^']*'|[^\s,;"']+)/g,
    replacement: '$1[REDACTED]'
  },
  {
    label: 'credential',
    pattern: /\b((?:(?:my|our|the|this|that)\s+)?(?:password|passwd|passphrase|secret|token|api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|client[\s_-]?secret|private[\s_-]?key)\s+(?:is|was|equals?))\s+(?:"[^"]+"|'[^']+'|[^\s,;]+)/gi,
    replacement: '$1 [REDACTED]'
  },
  {
    label: 'connection string',
    pattern: /\b(?:sftp|ssh|ftp|ftps|socks5?|https?):\/\/[^\s@/'"]+:[^\s@/'"]+@[^\s'"<>]+|\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql|sqlserver|clickhouse|cockroachdb):\/\/[^\s'"<>]+/gi,
    replacement: '[REDACTED_CONNECTION_URL]'
  },
  {
    label: 'absolute path',
    pattern: /(?:"[A-Za-z]:[\\/][^"\r\n]+"|'[A-Za-z]:[\\/][^'\r\n]+'|[A-Za-z]:\\(?:[^\\/\r\n"'<>|:*?,;]+\\)+[^\\/\s"'<>|:*?,;]+|[A-Za-z]:\/(?:[^\\/\r\n"'<>|:*?,;]+\/)+[^\\/\s"'<>|:*?,;]+|[A-Za-z]:[\\/][^\\/\s"'<>|:*?,;]+|\\\\[A-Za-z0-9._$-]+\\[^\s"'<>]+|"(?:\/[^"\r\n]+)"|'(?:\/[^'\r\n]+)'|(?<![A-Za-z0-9.:/])\/(?:[A-Za-z0-9._-]+(?: [A-Za-z0-9._-]+){0,2}\/)+[A-Za-z0-9._-]+)/g,
    replacement: '[REDACTED_PATH]',
    skipInDiagnostic: (match) => SAFE_DIAGNOSTIC_PATH_RE.test(match)
  },
  {
    label: 'SSH target',
    pattern: /\b[A-Za-z0-9._-]+@(?:(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}|(?:\d{1,3}\.){3}\d{1,3}|\[[^\]]+\]|localhost|[A-Za-z0-9-]{2,})(?::\d{1,5})?/g,
    replacement: '[REDACTED_HOST]'
  },
  {
    label: 'hostname',
    pattern: /(?<![A-Za-z0-9@/:._-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.){2,}[A-Za-z]{2,63}(?![A-Za-z0-9_-])|(?<![A-Za-z0-9@/:._-])(?!utf-\d+\b|sha-\d+\b|tls-\d|http-\d)(?:[A-Za-z][A-Za-z0-9]*-)+[A-Za-z0-9]*\d[A-Za-z0-9-]*(?![A-Za-z0-9_-])/gi,
    replacement: '[REDACTED_HOST]',
    strictOnly: true
  },
  {
    label: 'IPv6 address',
    pattern: /(?<![0-9a-fA-F:])(?:(?:[0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{1,4}|[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*::(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*)?|::[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*)(?![0-9a-fA-F:])/g,
    replacement: '[REDACTED_IP]'
  },
  {
    label: 'IP address',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g,
    replacement: '[REDACTED_IP]'
  }
]

/**
 * Redacts credentials (including natural-language forms), common provider tokens,
 * JWTs, private keys, connection strings, hostnames, IP addresses, and absolute paths.
 *
 * - `mode: 'strict'` (default): full redaction for public issue drafts and exports.
 * - `mode: 'diagnostic'`: preserves safe OS paths (`/var/log/*`, `/etc/*`, `/config/*`),
 *   Java/Python namespaces, and process/pod names for AI diagnostics while still redacting
 *   all secrets, tokens, keys, credentials, IPs, SSH targets, and user paths.
 */
export function redactSensitiveText(input: string, options?: RedactOptions): RedactionResult {
  if (!input) return { text: '', redactionCount: 0, categories: [] }

  const mode: RedactionMode = options?.mode ?? 'strict'
  let text = input
  let redactionCount = 0
  const categories: string[] = []

  for (const rule of REDACTION_RULES) {
    if (mode === 'diagnostic' && rule.strictOnly) continue
    let matched = false
    text = text.replace(rule.pattern, (...args) => {
      const fullMatch = args[0] as string
      if (mode === 'diagnostic' && rule.skipInDiagnostic?.(fullMatch)) {
        return fullMatch
      }
      matched = true
      redactionCount += 1
      if (rule.replacement.includes('$1') && typeof args[1] === 'string') {
        return rule.replacement.replace('$1', args[1])
      }
      return rule.replacement
    })
    if (matched && !categories.includes(rule.label)) {
      categories.push(rule.label)
    }
  }

  return { text, redactionCount, categories }
}

const CATEGORY_META: Record<IssueCategory, { prefix: string; label: string; heading: string }> = {
  bug: { prefix: '[Bug]', label: 'bug', heading: 'Bug Report' },
  feature: { prefix: '[Feature]', label: 'enhancement', heading: 'Feature Suggestion' },
  feedback: { prefix: '[Feedback]', label: 'feedback', heading: 'Feedback' }
}

export function buildGitHubIssueDraft(form: IssueDraftForm, diagnostics: SafeDiagnostics): BuiltIssueDraft {
  const meta = CATEGORY_META[form.category]
  const titleRedacted = redactSensitiveText(form.title.trim())
  const detailsRedacted = redactSensitiveText(form.details.trim())
  const expectedRedacted = redactSensitiveText(form.expected.trim())
  const actualRedacted = redactSensitiveText(form.actual.trim())
  const errorRedacted =
    form.includeDiagnostics && diagnostics.lastErrorSummary
      ? redactSensitiveText(diagnostics.lastErrorSummary.trim())
      : { text: '', redactionCount: 0, categories: [] }

  const redactionCount =
    titleRedacted.redactionCount +
    detailsRedacted.redactionCount +
    expectedRedacted.redactionCount +
    actualRedacted.redactionCount +
    errorRedacted.redactionCount

  const redactedCategories = Array.from(
    new Set([
      ...titleRedacted.categories,
      ...detailsRedacted.categories,
      ...expectedRedacted.categories,
      ...actualRedacted.categories,
      ...errorRedacted.categories
    ])
  )

  const finalTitle = titleRedacted.text
    ? titleRedacted.text.startsWith('[')
      ? titleRedacted.text
      : `${meta.prefix} ${titleRedacted.text}`
    : `${meta.prefix} Untitled`

  const sections: string[] = [`### ${meta.heading}`, '']
  if (detailsRedacted.text) {
    sections.push(form.category === 'bug' ? '#### Steps to reproduce' : '#### Details', detailsRedacted.text, '')
  }
  if (form.category === 'bug') {
    if (expectedRedacted.text) {
      sections.push('#### Expected behavior', expectedRedacted.text, '')
    }
    if (actualRedacted.text) {
      sections.push('#### Actual behavior', actualRedacted.text, '')
    }
  }

  sections.push(
    '#### Environment',
    `- **Ferry version:** ${diagnostics.appVersion || 'unknown'}`,
    `- **Platform:** ${diagnostics.platform || 'unknown'}`
  )

  if (form.includeDiagnostics) {
    if (diagnostics.dockPosition) {
      sections.push(`- **Dock orientation:** ${diagnostics.dockPosition}`)
    }
    if (diagnostics.theme) {
      sections.push(`- **Theme:** ${diagnostics.theme}`)
    }
    if (errorRedacted.text) {
      sections.push(`- **Sanitized last error:** ${errorRedacted.text}`)
    }
  }

  const markdown = sections.join('\n').trim()
  const labels = [meta.label]

  const fullParams = new URLSearchParams({
    title: finalTitle,
    labels: labels.join(','),
    body: markdown
  })
  const fullUrl = `${PUBLIC_ISSUE_TRACKER_URL}?${fullParams.toString()}`

  if (fullUrl.length <= MAX_SAFE_URL_LENGTH) {
    return {
      url: fullUrl,
      markdown,
      title: finalTitle,
      labels,
      redactionCount,
      redactedCategories,
      truncatedForUrl: false
    }
  }

  const shortParams = new URLSearchParams({
    title: finalTitle,
    labels: labels.join(','),
    body: 'Paste the copied draft from your clipboard here.'
  })
  return {
    url: `${PUBLIC_ISSUE_TRACKER_URL}?${shortParams.toString()}`,
    markdown,
    title: finalTitle,
    labels,
    redactionCount,
    redactedCategories,
    truncatedForUrl: true
  }
}
