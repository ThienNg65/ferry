import { describe, expect, it } from 'vitest'
import { mergeAnswers, partitionPrompts } from './keyboardInteractive'

describe('partitionPrompts', () => {
  it('auto-answers a password-style prompt when a password is available', () => {
    const { autoAnswered, needsUser } = partitionPrompts([{ prompt: 'Password:', echo: false }], 'secret123')
    expect(autoAnswered.get(0)).toBe('secret123')
    expect(needsUser).toEqual([])
  })

  it('is case-insensitive when recognizing a password prompt', () => {
    const { autoAnswered } = partitionPrompts([{ prompt: 'PASSWORD: ' }], 'secret123')
    expect(autoAnswered.get(0)).toBe('secret123')
  })

  it('forwards a non-password prompt (e.g. an OTP challenge) to the user, preserving its index', () => {
    const { autoAnswered, needsUser } = partitionPrompts([{ prompt: 'Verification code:', echo: true }], 'secret123')
    expect(autoAnswered.size).toBe(0)
    expect(needsUser).toEqual([{ index: 0, prompt: 'Verification code:', echo: true }])
  })

  it('defaults echo to false when ssh2 omits it', () => {
    const { needsUser } = partitionPrompts([{ prompt: 'OTP:' }], undefined)
    expect(needsUser[0].echo).toBe(false)
  })

  it('never auto-answers anything when no password is configured (key-based auth falling back to keyboard-interactive)', () => {
    const { autoAnswered, needsUser } = partitionPrompts([{ prompt: 'Password:' }], undefined)
    expect(autoAnswered.size).toBe(0)
    expect(needsUser).toHaveLength(1)
  })

  it('splits a mixed round: password prompt auto-answered, OTP prompt forwarded', () => {
    const { autoAnswered, needsUser } = partitionPrompts(
      [{ prompt: 'Password:' }, { prompt: 'Verification code:' }],
      'secret123'
    )
    expect(autoAnswered.get(0)).toBe('secret123')
    expect(needsUser).toEqual([{ index: 1, prompt: 'Verification code:', echo: false }])
  })
})

describe('mergeAnswers', () => {
  it('recombines auto-answered and user-supplied answers in original prompt order', () => {
    const autoAnswered = new Map([[0, 'secret123']])
    const needsUser = [{ index: 1, prompt: 'Verification code:', echo: false }]
    expect(mergeAnswers(2, autoAnswered, needsUser, ['654321'])).toEqual(['secret123', '654321'])
  })

  it('handles an all-auto-answered round with no user prompts', () => {
    const autoAnswered = new Map([[0, 'secret123']])
    expect(mergeAnswers(1, autoAnswered, [], [])).toEqual(['secret123'])
  })

  it('falls back to an empty string for any index neither side answered', () => {
    expect(mergeAnswers(1, new Map(), [], [])).toEqual([''])
  })
})
