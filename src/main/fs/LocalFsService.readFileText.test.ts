import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_TEXT_EDITOR_BYTES, MAX_TEXT_PREVIEW_BYTES } from '../../shared/contract'
import { readFileText } from './LocalFsService'

const tempDirs: string[] = []

function createTextFile(content: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ferry-read-text-'))
  tempDirs.push(dir)
  const filePath = path.join(dir, 'sample.txt')
  writeFileSync(filePath, content, 'utf-8')
  return filePath
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('LocalFsService.readFileText', () => {
  it('keeps the default preview read capped at one megabyte', async () => {
    const content = 'x'.repeat(MAX_TEXT_PREVIEW_BYTES + 1)
    const result = await readFileText(createTextFile(content))

    expect(result.content).toHaveLength(MAX_TEXT_PREVIEW_BYTES)
    expect(result.truncated).toBe(true)
    expect(result.size).toBe(content.length)
  })

  it('reads a two-megabyte file completely when the editor limit is requested', async () => {
    const content = 'x'.repeat(2 * 1024 * 1024)
    const result = await readFileText(createTextFile(content), MAX_TEXT_EDITOR_BYTES)

    expect(result.content).toBe(content)
    expect(result.truncated).toBe(false)
    expect(result.size).toBe(content.length)
  })

  it('truncates files above the editor limit and rejects unsafe limits', async () => {
    const content = 'x'.repeat(MAX_TEXT_EDITOR_BYTES + 1)
    const filePath = createTextFile(content)
    const result = await readFileText(filePath, MAX_TEXT_EDITOR_BYTES)

    expect(result.content).toHaveLength(MAX_TEXT_EDITOR_BYTES)
    expect(result.truncated).toBe(true)
    await expect(readFileText(filePath, MAX_TEXT_EDITOR_BYTES + 1)).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(readFileText(filePath, 0)).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})
