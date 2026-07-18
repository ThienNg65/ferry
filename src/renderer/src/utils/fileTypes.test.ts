import { describe, expect, it } from 'vitest'
import { colorForFile, iconForFile } from './fileTypes'

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

describe('colorForFile', () => {
  it('colors directories with the primary accent', () => {
    expect(colorForFile('archive.zip', true)).toBe('text-primary')
  })

  it('gives one representative bucket per type a distinct muted color', () => {
    expect(colorForFile('backup.zip', false)).toBe('text-amber-600 dark:text-amber-400')
    expect(colorForFile('photo.png', false)).toBe('text-violet-600 dark:text-violet-400')
    expect(colorForFile('clip.mp4', false)).toBe('text-rose-600 dark:text-rose-400')
    expect(colorForFile('song.mp3', false)).toBe('text-pink-600 dark:text-pink-400')
    expect(colorForFile('data.csv', false)).toBe('text-emerald-600 dark:text-emerald-400')
    expect(colorForFile('index.ts', false)).toBe('text-teal-600 dark:text-teal-400')
    expect(colorForFile('package.json', false)).toBe('text-teal-600 dark:text-teal-400')
  })

  it('keeps plain documents quiet (text-muted), restraint on the long tail', () => {
    expect(colorForFile('README.md', false)).toBe('text-muted')
    expect(colorForFile('notes.txt', false)).toBe('text-muted')
  })

  it('falls back to text-dimmed for unknown/no extension', () => {
    expect(colorForFile('LICENSE', false)).toBe('text-dimmed')
    expect(colorForFile('binary.exe', false)).toBe('text-dimmed')
  })
})
