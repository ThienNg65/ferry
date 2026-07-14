import { describe, expect, it } from 'vitest'
import { archiveBaseName, archiveKind, isArchive } from './archive'

describe('archiveKind', () => {
  it('recognizes .tar.gz and .tgz as targz, preferring the compound suffix over bare .tar', () => {
    expect(archiveKind('report.tar.gz')).toBe('targz')
    expect(archiveKind('report.tgz')).toBe('targz')
  })

  it('recognizes .tar.bz2 and .tbz2 as tarbz2', () => {
    expect(archiveKind('report.tar.bz2')).toBe('tarbz2')
    expect(archiveKind('report.tbz2')).toBe('tarbz2')
  })

  it('recognizes bare .tar and .zip', () => {
    expect(archiveKind('report.tar')).toBe('tar')
    expect(archiveKind('report.zip')).toBe('zip')
  })

  it('recognizes .jar/.war/.ear as zip-format', () => {
    expect(archiveKind('app.jar')).toBe('zip')
    expect(archiveKind('app.war')).toBe('zip')
    expect(archiveKind('app.ear')).toBe('zip')
  })

  it('is case-insensitive', () => {
    expect(archiveKind('REPORT.TAR.GZ')).toBe('targz')
  })

  it('returns null for unrecognized extensions, including .7z/.rar (deliberately unsupported)', () => {
    expect(archiveKind('notes.txt')).toBeNull()
    expect(archiveKind('archive.7z')).toBeNull()
    expect(archiveKind('archive.rar')).toBeNull()
  })
})

describe('isArchive', () => {
  it('mirrors archiveKind as a boolean', () => {
    expect(isArchive('report.zip')).toBe(true)
    expect(isArchive('notes.txt')).toBe(false)
  })
})

describe('archiveBaseName', () => {
  it('strips the recognized compound suffix', () => {
    expect(archiveBaseName('report.tar.gz')).toBe('report')
    expect(archiveBaseName('report.tbz2')).toBe('report')
  })

  it('strips a bare suffix', () => {
    expect(archiveBaseName('report.zip')).toBe('report')
  })

  it('leaves an unrecognized name untouched', () => {
    expect(archiveBaseName('notes.txt')).toBe('notes.txt')
  })
})
