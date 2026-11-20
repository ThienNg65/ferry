import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { LEGAL_RELATIVE_LINKS, renderLegalMarkdown } from '../renderLegalMarkdown'

const rootDir = resolve(__dirname, '../../../../..')
const privacyMd = readFileSync(resolve(rootDir, 'PRIVACY.md'), 'utf8')
const termsMd = readFileSync(resolve(rootDir, 'TERMS.md'), 'utf8')

describe('renderLegalMarkdown', () => {
  it('renders PRIVACY.md headings, hard line breaks, immediate lists, tables, inline code URLs, and safe links', () => {
    const html = renderLegalMarkdown(privacyMd)

    expect(html).toContain('<h1>Privacy Policy for Ferry</h1>')
    expect(html).toContain('<h2>1. Data We Do Not Collect</h2>')
    expect(html).toContain('<strong>Effective Date:</strong> 2026-11-14<br /><strong>Policy Version:</strong> 1.0<br />')
    expect(html).toContain('<p>Ferry does <strong>not</strong>:</p>\n<ul><li>Collect, transmit, or sell personal data')
    expect(html).toContain('<table><thead><tr><th scope="col">Data</th><th scope="col">Storage Location</th>')
    expect(html).toContain('<tbody><tr><td>Saved Sites &amp; Proxy Settings</td>')
    expect(html).toContain('<ol><li><strong>Your SSH / SFTP / Proxy Connections:</strong>')
    expect(html).toContain('<code>https://github.com/ThienNg65/ferry-release/releases/latest/download</code>')
    expect(html).toContain(
      '<a href="https://github.com/ThienNg65/ferry/issues" target="_blank" rel="noopener noreferrer">GitHub Issues</a>'
    )
  })

  it('renders TERMS.md relative legal links and lists', () => {
    const html = renderLegalMarkdown(termsMd)

    expect(html).toContain('<h1>Terms of Service for Ferry</h1>')
    expect(html).toContain(
      `<a href="${LEGAL_RELATIVE_LINKS.LICENSE.href}" target="_blank" rel="noopener noreferrer">MIT License</a>`
    )
    expect(html).toContain(
      `<a href="${LEGAL_RELATIVE_LINKS['THIRD_PARTY_LICENSES.txt'].href}" target="_blank" rel="noopener noreferrer" data-legal-doc="licenses">THIRD_PARTY_LICENSES.txt</a>`
    )
    expect(html).toContain('<p>You are solely responsible for how you use Ferry and for all data you transfer or modify using it. You agree to:</p>\n<ul>')
  })

  it('escapes raw HTML tags and strips unsafe link schemes such as javascript: and http:', () => {
    const malicious = [
      '# Title <script>alert(1)</script>',
      '',
      'Click [bad](javascript:alert(1)) or [insecure](http://example.com) or `<img src=x onerror=alert(1)>`.',
      '',
      '<img src=x onerror="alert(2)">'
    ].join('\n')

    const html = renderLegalMarkdown(malicious)

    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('http://example.com')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('<code>&lt;img src=x onerror=alert(1)&gt;</code>')
    expect(html).toContain('Click bad or insecure or')
  })
})
