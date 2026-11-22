import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupStagedDropPath, stageDroppedEntries } from './LocalFsService'

const stagedRoots: string[] = []

afterEach(() => {
  for (const root of stagedRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('LocalFsService staged local-folder moves', () => {
  it('prunes a shared staging root only after the last moved item is cleaned', async () => {
    const result = await stageDroppedEntries({
      entries: [
        { relativePath: 'report.txt', isDir: false, data: new TextEncoder().encode('report') },
        { relativePath: 'bundle', isDir: true },
        { relativePath: 'bundle/config.json', isDir: false, data: new TextEncoder().encode('{"ok":true}') }
      ]
    })
    const stageRoot = path.dirname(result[0].path)
    const destinationRoot = mkdtempSync(path.join(os.tmpdir(), 'ferry-local-drop-target-'))
    stagedRoots.push(stageRoot, destinationRoot)

    renameSync(result[0].path, path.join(destinationRoot, result[0].name))
    await cleanupStagedDropPath(result[0].path)

    expect(existsSync(stageRoot)).toBe(true)
    expect(existsSync(result[1].path)).toBe(true)

    renameSync(result[1].path, path.join(destinationRoot, result[1].name))
    await cleanupStagedDropPath(result[1].path)

    expect(existsSync(stageRoot)).toBe(false)
    expect(readFileSync(path.join(destinationRoot, 'bundle', 'config.json'), 'utf8')).toBe('{"ok":true}')
  })
})
