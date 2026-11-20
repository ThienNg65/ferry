import { describe, expect, it } from 'vitest'
import { resolveConflicts, uniqueName, type ConflictIntent } from './resolveConflicts'

const up = (name: string, modified: string | null, isDir = false): ConflictIntent => ({
  direction: 'upload',
  localPath: `C:\\src\\${name}`,
  remotePath: `/srv/${name}`,
  isDir,
  targetName: name,
  sourceModifiedAt: modified
})

const targets = [
  { name: 'a.txt', modifiedAt: '2026-01-02T00:00:00Z' },
  { name: 'b.txt', modifiedAt: '2026-01-02T00:00:00Z' },
  { name: 'a (1).txt', modifiedAt: null }
]

describe('resolveConflicts', () => {
  const intents = [up('a.txt', '2026-01-03T00:00:00Z'), up('b.txt', '2026-01-01T00:00:00Z'), up('new.txt', null)]

  it('overwrite keeps everything', () => {
    expect(resolveConflicts(intents, targets, 'overwrite')).toHaveLength(3)
  })
  it('skip drops only conflicting items', () => {
    expect(resolveConflicts(intents, targets, 'skip').map((i) => i.targetName)).toEqual(['new.txt'])
  })
  it('newer keeps only strictly newer sources and non-conflicting items', () => {
    expect(resolveConflicts(intents, targets, 'newer').map((i) => i.targetName)).toEqual(['a.txt', 'new.txt'])
  })
  it('newer skips when a date is unknown but merges folders', () => {
    expect(resolveConflicts([up('a.txt', null)], targets, 'newer')).toEqual([])
    expect(resolveConflicts([up('a.txt', null, true)], targets, 'newer')).toHaveLength(1)
  })
  it('rename picks free names and rewrites the target path', () => {
    const out = resolveConflicts(intents, targets, 'rename')
    expect(out.map((i) => i.targetName)).toEqual(['a (2).txt', 'b (1).txt', 'new.txt'])
    expect(out[0].remotePath).toBe('/srv/a (2).txt')
    expect(out[0].localPath).toBe('C:\\src\\a.txt')
  })
  it('rename avoids names used by other items in the same batch', () => {
    const out = resolveConflicts([up('a.txt', null), up('a (1).txt', null)], [{ name: 'a.txt', modifiedAt: null }], 'rename')
    expect(new Set(out.map((i) => i.remotePath)).size).toBe(2)
  })
  it('rename rewrites the local path for downloads', () => {
    const down: ConflictIntent = { ...up('a.txt', null), direction: 'download', localPath: 'C:\\dst\\a.txt', remotePath: '/srv/a.txt' }
    expect(resolveConflicts([down], targets, 'rename')[0].localPath).toBe('C:\\dst\\a (2).txt')
  })

  it('matches case-insensitively on Windows local downloads', () => {
    const down: ConflictIntent = { ...up('A.TXT', null), direction: 'download', localPath: 'C:\\dst\\A.TXT', remotePath: '/srv/A.TXT' }
    expect(resolveConflicts([down], targets, 'skip')).toEqual([])
    expect(resolveConflicts([down], targets, 'rename')[0].targetName).toBe('A (2).TXT')
  })
})

describe('uniqueName', () => {
  it('keeps the extension and skips taken names', () => {
    expect(uniqueName('x.tar.gz', new Set(['x.tar (1).gz']), false)).toBe('x.tar (2).gz')
    expect(uniqueName('docs', new Set(), true)).toBe('docs (1)')
    expect(uniqueName('.env', new Set(), false)).toBe('.env (1)')
  })
})
