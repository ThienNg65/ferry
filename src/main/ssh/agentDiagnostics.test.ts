import { describe, expect, it } from 'vitest'
import { rewriteAgentAuthError } from './agentDiagnostics'

describe('rewriteAgentAuthError', () => {
  it('rewrites ssh2\'s generic "all auth methods failed" message into an actionable one', () => {
    const rewritten = rewriteAgentAuthError('All configured authentication methods failed', 2)
    expect(rewritten).toContain('2 keys')
    expect(rewritten).toContain('authorized_keys')
  })

  it('uses singular "key" for exactly one offered identity', () => {
    const rewritten = rewriteAgentAuthError('All configured authentication methods failed', 1)
    expect(rewritten).toContain('1 key ')
  })

  it('leaves unrelated error messages untouched', () => {
    const message = 'ECONNREFUSED connecting to host'
    expect(rewriteAgentAuthError(message, 3)).toBe(message)
  })
})
