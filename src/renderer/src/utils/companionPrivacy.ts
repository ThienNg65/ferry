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

const REDACTION_RULES: Array<{ label: string; pattern: RegExp; replacement: string }> = [
  {
    label: 'private key',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]'
  },
  {
    label: 'auth token',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{16,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b|\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b|\bAIza[0-9A-Za-z_-]{30,}\b|\bxox[a-z]-[A-Za-z0-9-]{10,}\b|\bya29\.[A-Za-z0-9_-]{20,}\b|\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED_TOKEN]'
  },
  {
    label: 'bearer header',
    pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}(?=\s|$|['",;])/gi,
    replacement: '$1 [REDACTED]'
  },
  {
    label: 'credential',
    pattern: /(?<![A-Za-z0-9])([A-Za-z0-9_]*(?:password|passwd|passphrase|secret|token|api[_-]?key|authorization))\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    replacement: '$1=[REDACTED]'
  },
  {
    label: 'credential',
    pattern: /\b((?:(?:my|our|the|this|that)\s+)?(?:password|passwd|passphrase|secret|token|api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|client[\s_-]?secret|private[\s_-]?key)\s+(?:is|was|equals?))\s+(?:"[^"]+"|'[^']+'|[A-Za-z0-9._~+/=-]{4,})/gi,
    replacement: '$1 [REDACTED]'
  },
  {
    label: 'connection string',
    pattern: /\b(?:sftp|ssh|ftp|ftps|socks5?|https?):\/\/[^\s@/'"]+:[^\s@/'"]+@[^\s'"<>]+/gi,
    replacement: '[REDACTED_CONNECTION_URL]'
  },
  {
    label: 'absolute path',
    pattern: /(?:"[A-Za-z]:[\\/][^"\r\n]+"|'[A-Za-z]:[\\/][^'\r\n]+'|[A-Za-z]:[\\/](?:[^\\/\s"'<>|:*?]+[\\/])*[^\\/\s"'<>|:*?]+|\\\\[A-Za-z0-9._$-]+\\[^\s"'<>]+|(?<![A-Za-z0-9.:/])\/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+)/g,
    replacement: '[REDACTED_PATH]'
  },
  {
    label: 'SSH target',
    pattern: /\b[A-Za-z0-9._-]+@(?:(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}|(?:\d{1,3}\.){3}\d{1,3}|\[[^\]]+\]|localhost|[A-Za-z0-9-]{2,})(?::\d{1,5})?/g,
    replacement: '[REDACTED_HOST]'
  },
  {
    label: 'hostname',
    pattern: /(?<![A-Za-z0-9@/:._-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.){2,}[A-Za-z]{2,63}(?![A-Za-z0-9_-])|(?<![A-Za-z0-9@/:._-])[A-Za-z][A-Za-z0-9]*-[A-Za-z0-9]*\d[A-Za-z0-9-]*(?![A-Za-z0-9_-])/g,
    replacement: '[REDACTED_HOST]'
  },
  {
    label: 'IPv6 address',
    pattern: /(?<![0-9a-fA-F:])(?:(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}|[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*::(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*)?|::[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*)(?![0-9a-fA-F:])/g,
    replacement: '[REDACTED_IP]'
  },
  {
    label: 'IP address',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g,
    replacement: '[REDACTED_IP]'
  },

]

/**
 * Redacts credentials (including natural-language forms), common provider tokens,
 * private keys, connection strings, hostnames, IP addresses, and absolute paths.
 */
export function redactSensitiveText(input: string): RedactionResult {
  if (!input) return { text: '', redactionCount: 0, categories: [] }

  let text = input
  let redactionCount = 0
  const categories: string[] = []

  for (const rule of REDACTION_RULES) {
    let matched = false
    text = text.replace(rule.pattern, (...args) => {
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
