export interface LegalRelativeLink {
  href: string
  doc?: 'licenses'
}

export const LEGAL_RELATIVE_LINKS: Record<string, LegalRelativeLink> = {
  LICENSE: { href: 'https://github.com/ThienNg65/ferry/blob/main/LICENSE' },
  'THIRD_PARTY_LICENSES.txt': {
    href: 'https://github.com/ThienNg65/ferry/blob/main/THIRD_PARTY_LICENSES.txt',
    doc: 'licenses'
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatBold(escapedText: string): string {
  return escapedText.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function resolveSafeLink(rawHref: string): LegalRelativeLink | null {
  const trimmed = rawHref.trim()
  const relative = LEGAL_RELATIVE_LINKS[trimmed]
  if (relative) return relative
  if (!trimmed.startsWith('https://')) return null
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'https:' ? { href: parsed.toString() } : null
  } catch {
    return null
  }
}

function formatLinksAndBold(text: string): string {
  const parts = text.split(/(\[[^\]]+\]\((?:[^()]|\([^()]*\))+\))/g)
  let out = ''
  for (const part of parts) {
    if (!part) continue
    const match = part.match(/^\[([^\]]+)\]\(((?:[^()]|\([^()]*\))+)\)$/)
    if (match) {
      const labelHtml = formatBold(escapeHtml(match[1]))
      const resolved = resolveSafeLink(match[2])
      if (resolved) {
        const docAttr = resolved.doc ? ` data-legal-doc="${resolved.doc}"` : ''
        out += `<a href="${escapeHtml(resolved.href)}" target="_blank" rel="noopener noreferrer"${docAttr}>${labelHtml}</a>`
      } else {
        out += labelHtml
      }
    } else {
      out += formatBold(escapeHtml(part))
    }
  }
  return out
}

function formatInline(text: string): string {
  const parts = text.split(/(`[^`]+`)/g)
  let out = ''
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]
    if (!part) continue
    if (i % 2 === 1 && part.startsWith('`') && part.endsWith('`')) {
      out += `<code>${escapeHtml(part.slice(1, -1))}</code>`
    } else {
      out += formatLinksAndBold(part)
    }
  }
  return out
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim())
}

function isTableDelimiter(line: string): boolean {
  return /^\|(?:\s*:?-+:?\s*\|)+$/.test(line.trim())
}

function isPipeRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2
}

/**
 * Renders Ferry's legal Markdown (`PRIVACY.md`, `TERMS.md`) into XSS-safe semantic HTML.
 * Supports `#`–`###` headings, trailing two-space `<br />` breaks, `<ul>`/`<ol>` lists
 * directly after paragraphs without blank lines, pipe tables, `**bold**`, `` `code` ``,
 * and `https://` + known relative legal links.
 */
export function renderLegalMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []

  let paragraphLines: Array<{ text: string; hardBreak: boolean }> = []
  let listType: 'ul' | 'ol' | null = null
  let listItems: string[] = []

  const flushParagraph = (): void => {
    if (paragraphLines.length === 0) return
    let body = ''
    for (let i = 0; i < paragraphLines.length; i += 1) {
      const seg = paragraphLines[i]
      body += formatInline(seg.text)
      if (i < paragraphLines.length - 1) {
        body += seg.hardBreak ? '<br />' : ' '
      }
    }
    html.push(`<p>${body}</p>`)
    paragraphLines = []
  }

  const flushList = (): void => {
    if (!listType || listItems.length === 0) {
      listType = null
      listItems = []
      return
    }
    html.push(`<${listType}>${listItems.join('')}</${listType}>`)
    listType = null
    listItems = []
  }

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i]
    const trimmed = rawLine.trim()

    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/)
    if (headingMatch) {
      flushParagraph()
      flushList()
      const level = headingMatch[1].length
      html.push(`<h${level}>${formatInline(headingMatch[2].trim())}</h${level}>`)
      continue
    }

    if (isPipeRow(trimmed) && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      flushParagraph()
      flushList()
      const headers = parseTableRow(trimmed)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isPipeRow(lines[i])) {
        rows.push(parseTableRow(lines[i]))
        i += 1
      }
      i -= 1
      const thead = `<thead><tr>${headers.map((h) => `<th scope="col">${formatInline(h)}</th>`).join('')}</tr></thead>`
      const tbody =
        rows.length > 0
          ? `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${formatInline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
          : ''
      html.push(`<table>${thead}${tbody}</table>`)
      continue
    }

    const ulMatch = trimmed.match(/^-\s+(.*)$/)
    if (ulMatch) {
      flushParagraph()
      if (listType !== 'ul') {
        flushList()
        listType = 'ul'
      }
      listItems.push(`<li>${formatInline(ulMatch[1])}</li>`)
      continue
    }

    const olMatch = trimmed.match(/^\d+\.\s+(.*)$/)
    if (olMatch) {
      flushParagraph()
      if (listType !== 'ol') {
        flushList()
        listType = 'ol'
      }
      listItems.push(`<li>${formatInline(olMatch[1])}</li>`)
      continue
    }

    flushList()
    const hardBreak = / {2,}$/.test(rawLine)
    paragraphLines.push({ text: rawLine.trim(), hardBreak })
  }

  flushParagraph()
  flushList()
  return html.join('\n')
}
