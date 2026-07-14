import { describe, expect, it } from 'vitest'
import { iconForFile } from './fileTypes'

describe('iconForFile', () => {
  it('always returns the folder icon for directories, regardless of name', () => {
    expect(iconForFile('archive.zip', true)).toBe('i-lucide-folder')
  })

  it('picks the archive icon before falling through to extension buckets', () => {
    expect(iconForFile('backup.tar.gz', false)).toBe('i-lucide-file-archive')
    expect(iconForFile('site.zip', false)).toBe('i-lucide-file-archive')
  })

  it('recognizes images, video, audio, and spreadsheets', () => {
    expect(iconForFile('photo.PNG', false)).toBe('i-lucide-file-image')
    expect(iconForFile('clip.mp4', false)).toBe('i-lucide-file-video')
    expect(iconForFile('song.mp3', false)).toBe('i-lucide-file-audio')
    expect(iconForFile('data.csv', false)).toBe('i-lucide-file-spreadsheet')
  })

  it('gives JSON its own icon distinct from other code files', () => {
    expect(iconForFile('package.json', false)).toBe('i-lucide-file-json')
    expect(iconForFile('index.ts', false)).toBe('i-lucide-file-code')
  })

  it('treats plain-text/config/doc extensions as documents', () => {
    expect(iconForFile('README.md', false)).toBe('i-lucide-file-text')
    expect(iconForFile('report.pdf', false)).toBe('i-lucide-file-text')
  })

  it('falls back to the generic file icon for unknown/no extension', () => {
    expect(iconForFile('LICENSE', false)).toBe('i-lucide-file')
    expect(iconForFile('binary.exe', false)).toBe('i-lucide-file')
  })
})
