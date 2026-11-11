import { describe, expect, it } from 'vitest'
import { friendlyConnectError } from './friendlyConnectError'

describe('friendlyConnectError', () => {
  it.each([
    ['All configured authentication methods failed', 'Wrong username, password or key (All configured authentication methods failed)'],
    ['connect ECONNREFUSED 10.0.0.1:22', 'Nothing is listening on h:22 (connect ECONNREFUSED 10.0.0.1:22)'],
    ['getaddrinfo ENOTFOUND h', 'Host not found: h (getaddrinfo ENOTFOUND h)'],
    ['connect EHOSTUNREACH 1.2.3.4:22', 'h is unreachable (connect EHOSTUNREACH 1.2.3.4:22)'],
    ['connect ETIMEDOUT 1.2.3.4:22', 'Connection to h:22 timed out (connect ETIMEDOUT 1.2.3.4:22)'],
    ['something else', 'something else']
  ])('%s', (raw, expected) => {
    expect(friendlyConnectError(raw, 'h', 22)).toBe(expected)
  })
})
