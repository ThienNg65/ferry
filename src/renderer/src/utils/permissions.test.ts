import { describe, expect, it } from 'vitest'
import { formatMode, parseMode, toFriendlyLabel, toTechnical } from './permissions'

describe('parseMode', () => {
  it('parses a 4-digit octal string into owner/group/other triplets', () => {
    const { owner, group, other } = parseMode('0755')
    expect(owner).toEqual({ read: true, write: true, execute: true })
    expect(group).toEqual({ read: true, write: false, execute: true })
    expect(other).toEqual({ read: true, write: false, execute: true })
  })

  it('parses a bare 3-digit octal string the same way', () => {
    expect(parseMode('640')).toEqual(parseMode('0640'))
  })

  it('round-trips through formatMode back to the original 3 digits', () => {
    expect(formatMode(parseMode('0754'))).toBe('754')
  })
})

describe('formatMode', () => {
  it('formats all-zero triplets as "000"', () => {
    const none = { read: false, write: false, execute: false }
    expect(formatMode({ owner: none, group: none, other: none })).toBe('000')
  })

  it('formats all-on triplets as "777"', () => {
    const all = { read: true, write: true, execute: true }
    expect(formatMode({ owner: all, group: all, other: all })).toBe('777')
  })
})

describe('toTechnical / toFriendlyLabel (existing behavior, unchanged by the parseMode/formatMode addition)', () => {
  it('still renders the classic rwx string', () => {
    expect(toTechnical('0755')).toBe('rwxr-xr-x')
  })

  it('still renders the owner-scoped friendly label', () => {
    expect(toFriendlyLabel('0644')).toBe('Read & Write')
  })
})
