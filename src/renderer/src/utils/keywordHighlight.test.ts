import { describe, expect, it } from 'vitest'
import { buildKeywordRegex, splitByKeywords } from './keywordHighlight'

describe('keywordHighlight', () => {
  it('returns one plain chunk when there are no keywords', () => {
    expect(splitByKeywords('hello', buildKeywordRegex([]))).toEqual([{ text: 'hello', group: null }])
  })

  it('assigns each keyword its own group, case-insensitively', () => {
    const regex = buildKeywordRegex(['error', 'timeout'])
    expect(splitByKeywords('An ERROR then a Timeout.', regex)).toEqual([
      { text: 'An ', group: null },
      { text: 'ERROR', group: 0 },
      { text: ' then a ', group: null },
      { text: 'Timeout', group: 1 },
      { text: '.', group: null }
    ])
  })

  it('escapes regex metacharacters in keywords', () => {
    const regex = buildKeywordRegex(['a.b', '(x)'])
    expect(splitByKeywords('a.b axb (x)', regex).filter((c) => c.group !== null).map((c) => c.text)).toEqual(['a.b', '(x)'])
  })
})
