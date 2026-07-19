import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openPath: vi.fn(async () => '') }
}))

vi.mock('../fs/RemoteFsService', () => ({
  downloadForEdit: vi.fn(async (_sessionId: string, _remotePath: string, localPath: string) => {
    await fs.writeFile(localPath, 'original content')
  }),
  uploadForEdit: vi.fn(async () => {})
}))

async function tempSubdirsFor(sessionId: string): Promise<string[]> {
  try {
    return await fs.readdir(path.join(os.tmpdir(), 'ferry-edit', sessionId))
  } catch {
    return []
  }
}

describe('EditSessionManager', () => {
  let EditSessionManager: typeof import('./EditSessionManager').EditSessionManager

  beforeEach(async () => {
    vi.resetModules()
    ;({ EditSessionManager } = await import('./EditSessionManager'))
  })

  afterEach(async () => {
    await EditSessionManager.getInstance().disposeAll()
  })

  it('dedups: opening the same (sessionId, remotePath) twice reuses the existing temp file/editId instead of re-downloading', async () => {
    const manager = EditSessionManager.getInstance()
    const sessionId = `session-${randomUUID()}`
    const { downloadForEdit } = await import('../fs/RemoteFsService')

    const first = await manager.openRemote(sessionId, '/remote/report.txt')
    const second = await manager.openRemote(sessionId, '/remote/report.txt')

    expect(second.editId).toBe(first.editId)
    expect(downloadForEdit).toHaveBeenCalledOnce()
  })

  it('disposeAll deletes a fully-synced temp file but preserves one with local changes never re-uploaded', async () => {
    const manager = EditSessionManager.getInstance()
    const sessionId = `session-${randomUUID()}`

    const before1 = await tempSubdirsFor(sessionId)
    await manager.openRemote(sessionId, '/remote/synced.txt')
    const after1 = await tempSubdirsFor(sessionId)
    const syncedSubdir = after1.find((d) => !before1.includes(d))
    expect(syncedSubdir).toBeDefined()
    const syncedPath = path.join(os.tmpdir(), 'ferry-edit', sessionId, syncedSubdir as string, 'synced.txt')

    await manager.openRemote(sessionId, '/remote/unsynced.txt')
    const after2 = await tempSubdirsFor(sessionId)
    const unsyncedSubdir = after2.find((d) => !after1.includes(d))
    expect(unsyncedSubdir).toBeDefined()
    const unsyncedPath = path.join(os.tmpdir(), 'ferry-edit', sessionId, unsyncedSubdir as string, 'unsynced.txt')

    // Simulate a local edit that hasn't made it back to the server yet (the
    // debounced re-upload is still pending) — disposeAll must cancel that
    // pending timer rather than let it race the dispose, and must never
    // delete a file whose mtime moved past its last confirmed upload. The
    // small delay guarantees a measurably later mtime than the initial
    // download's — without it, two writes this close together can land
    // within the same filesystem mtime tick and make the test itself flaky,
    // which isn't a realistic concern for real human-editing-timescale saves.
    await new Promise((resolve) => setTimeout(resolve, 50))
    await fs.writeFile(unsyncedPath, 'edited but not yet synced')

    await manager.disposeAll()

    await expect(fs.access(syncedPath)).rejects.toThrow()
    await expect(fs.access(unsyncedPath)).resolves.toBeUndefined()
  })
})
