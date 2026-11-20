import { describe, expect, it } from 'vitest'
import type { FileEntry } from '@shared/contract'
import {
  appendUniquePattern,
  composePaneEntries,
  createVisibilityMatcher,
  emptyVisibilityFilter,
  formatPatternLines,
  hasActiveVisibilityFilter,
  matchGlob,
  parsePatternLines,
  suggestPatternsFromFilename
} from './fileVisibilityFilter'

function file(name: string, path = `/var/log/${name}`): FileEntry {
  return {
    name,
    path,
    isDir: false,
    isSymlink: false,
    size: 128,
    modifiedAt: '2026-07-13T10:00:00.000Z'
  }
}

function dir(name: string, path = `/var/log/${name}`): FileEntry {
  return {
    name,
    path,
    isDir: true,
    isSymlink: false,
    size: 0,
    modifiedAt: '2026-07-13T10:00:00.000Z'
  }
}

describe('pattern line helpers', () => {
  it('parses trimmed non-empty unique pattern lines and formats them back', () => {
    const parsed = parsePatternLines('  *.log  \n\n*.log.????-??-??\r\n*.log\n  ')
    expect(parsed).toEqual(['*.log', '*.log.????-??-??'])
    expect(formatPatternLines(parsed)).toBe('*.log\n*.log.????-??-??')
  })

  it('appends a pattern uniquely without duplicating existing entries', () => {
    expect(appendUniquePattern(['*.log'], '*.log')).toEqual(['*.log'])
    expect(appendUniquePattern(['*.log'], ' *.tmp ')).toEqual(['*.log', '*.tmp'])
    expect(appendUniquePattern(['*.log'], '   ')).toEqual(['*.log'])
  })

  it('reports whether a visibility filter has active patterns', () => {
    expect(hasActiveVisibilityFilter(emptyVisibilityFilter())).toBe(false)
    expect(hasActiveVisibilityFilter({ include: ['*.log'], exclude: [] })).toBe(true)
    expect(hasActiveVisibilityFilter({ include: [], exclude: ['*.tmp'] })).toBe(true)
  })
})

describe('compileGlob and createVisibilityMatcher', () => {
  it('hides date-suffixed rotated logs while keeping active log and directories visible', () => {
    const entries = [
      dir('archive'),
      file('cob-address-verification-adapter-service.log'),
      file('cob-address-verification-adapter-service.log.2026-06-17'),
      file('cob-address-verification-adapter-service.log.2026-06-18'),
      file('cob-address-verification-adapter-service.log.2026-07-13')
    ]
    const matcher = createVisibilityMatcher({
      include: [],
      exclude: ['*.log.????-??-??']
    })
    expect(entries.filter(matcher).map((e) => e.name)).toEqual([
      'archive',
      'cob-address-verification-adapter-service.log'
    ])
  })

  it('applies OR within include/exclude and gives exclude precedence over include', () => {
    const entries = [
      dir('app.log.2026-06-17'),
      file('app.log'),
      file('worker.log'),
      file('debug.log'),
      file('app.conf'),
      file('notes.txt'),
      file('app.log.2026-06-17')
    ]
    const matcher = createVisibilityMatcher({
      include: ['*.log', '*.conf'],
      exclude: ['debug.*', '*.log.????-??-??']
    })
    expect(entries.filter(matcher).map((e) => e.name)).toEqual([
      'app.log.2026-06-17', // directory stays visible
      'app.log',
      'worker.log',
      'app.conf'
    ])
  })

  it('uses case-sensitive basename matching', () => {
    expect(matchGlob('App.log', 'App.log')).toBe(true)
    expect(matchGlob('App.log', 'app.log')).toBe(false)
    expect(matchGlob('App.log', '/var/log/App.log')).toBe(false)

    const matcher = createVisibilityMatcher({ include: ['*.log'], exclude: [] })
    expect(matcher(file('app.log', '/dir/app.log'))).toBe(true)
    expect(matcher(file('app.LOG', '/dir/app.LOG'))).toBe(false)
  })

  it('matches regex metacharacters literally in glob patterns', () => {
    expect(matchGlob('report[1]+(v2).log', 'report[1]+(v2).log')).toBe(true)
    expect(matchGlob('report[1]+(v2).log', 'report1+(v2).log')).toBe(false)
    expect(matchGlob('a.log', 'axlog')).toBe(false)
  })

  it('bounds matching cost for wildcard-heavy nonmatching patterns', () => {
    expect(matchGlob('*a*a*a*a*b', 'xxaayyazzab')).toBe(true)
    expect(matchGlob('app***', 'app.log')).toBe(true)
    expect(matchGlob('***', '')).toBe(true)

    const start = performance.now()
    expect(matchGlob('**********.log', `${'a'.repeat(100)}.txt`)).toBe(false)
    expect(matchGlob('*a*a*a*a*a*a*a*a*a*a*a*a*b', `${'a'.repeat(100)}.txt`)).toBe(false)
    const elapsedMs = performance.now() - start
    expect(elapsedMs).toBeLessThan(50)
  })

  it('always keeps directories visible regardless of patterns', () => {
    const matcher = createVisibilityMatcher({
      include: ['*.only'],
      exclude: ['*', 'logs']
    })
    expect(matcher(dir('logs'))).toBe(true)
    expect(matcher(dir('anything'))).toBe(true)
    expect(matcher(file('test.only'))).toBe(false)
  })

  it('filters thousands of entries cleanly and quickly', () => {
    const entries: FileEntry[] = [dir('sub')]
    for (let i = 0; i < 5000; i++) {
      entries.push(
        file(i % 10 === 0 ? `service-${i}.log` : `service-${i}.log.2026-06-17`)
      )
    }
    const matcher = createVisibilityMatcher({
      include: ['*.log*'],
      exclude: ['*.log.????-??-??']
    })
    const visible = entries.filter(matcher)
    expect(visible.length).toBe(501) // 1 dir + 500 plain .log files
  })
})

describe('suggestPatternsFromFilename', () => {
  it('generates rotated date-glob patterns for hyphenated dated log filenames', () => {
    const suggestions = suggestPatternsFromFilename(
      'cob-address-verification-adapter-service.log.2026-06-17'
    )
    const patterns = suggestions.map((s) => s.pattern)
    expect(patterns).toContain('*.log.????-??-??')
    expect(patterns).toContain('cob-address-verification-adapter-service.log.????-??-??')

    const dotted = suggestPatternsFromFilename('my.service.log.2026-06-17').map((s) => s.pattern)
    expect(dotted).toContain('*.log.????-??-??')
  })

  it('strips directory paths from Unix or Windows paths before generating patterns', () => {
    const unix = suggestPatternsFromFilename('/var/log/nginx/access.log.1').map((s) => s.pattern)
    expect(unix).toContain('*.log.*')
    expect(unix).toContain('access.log.*')

    const win = suggestPatternsFromFilename('C:\\logs\\app.log.2026-06-17').map((s) => s.pattern)
    expect(win).toContain('*.log.????-??-??')
  })

  it('suggests patterns for compact dates, compound extensions, and plain extensions', () => {
    expect(suggestPatternsFromFilename('backup_20260617.tar.gz').map((s) => s.pattern)).toContain(
      '*.tar.gz'
    )
    expect(suggestPatternsFromFilename('app.log').map((s) => s.pattern)).toContain('*.log')
    expect(suggestPatternsFromFilename('Makefile').map((s) => s.pattern)).toEqual(['Makefile'])
    expect(suggestPatternsFromFilename('   ')).toEqual([])
  })
})

describe('composePaneEntries', () => {
  it('composes showHidden, visibilityFilter, and searchQuery independently and computes file counts', () => {
    const entries = [
      dir('.git'),
      dir('logs'),
      file('.env'),
      file('app.log'),
      file('app.log.2026-06-17'),
      file('worker.log'),
      file('readme.md')
    ]

    const hiddenOff = composePaneEntries(entries, {
      showHidden: false,
      visibilityFilter: { include: ['*.log*'], exclude: ['*.log.????-??-??'] },
      searchQuery: ''
    })
    expect(hiddenOff.entries.map((e) => e.name)).toEqual(['logs', 'app.log', 'worker.log'])
    expect(hiddenOff.totalFiles).toBe(4) // .env excluded by showHidden; 2 dirs excluded from file count
    expect(hiddenOff.visibleFiles).toBe(2)
    expect(hiddenOff.visibilityActive).toBe(true)
    expect(hiddenOff.searchActive).toBe(false)

    const withSearch = composePaneEntries(entries, {
      showHidden: true,
      visibilityFilter: { include: ['*.log*'], exclude: ['*.log.????-??-??'] },
      searchQuery: 'worker'
    })
    expect(withSearch.entries.map((e) => e.name)).toEqual(['worker.log'])
    expect(withSearch.totalFiles).toBe(5)
    expect(withSearch.visibleFiles).toBe(1)
    expect(withSearch.visibilityActive).toBe(true)
    expect(withSearch.searchActive).toBe(true)
  })
})
