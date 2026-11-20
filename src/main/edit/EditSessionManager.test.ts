import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { testHost } from '../host/testHost.setup'
import { setHost } from '../host/host'

setHost({ ...testHost, openPath: vi.fn(async () => '') })

vi.mock('../fs/RemoteFsService', () => ({
  downloadForEdit: vi.fn(async (_sessionId: string, _remotePath: string, localPath: string) => {
    await fs.writeFile(localPath, 'original content')
  }),
  uploadForEdit: vi.fn(async () => {}),
  statRemoteForEdit: vi.fn(async () => null)
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

    // Some editors preserve the original modification time on save.
    await fs.writeFile(unsyncedPath, 'edited but not yet synced')
    const older = new Date('2001-01-01T00:00:00.000Z')
    await fs.utimes(unsyncedPath, older, older)

    await manager.disposeAll()

    await expect(fs.access(syncedPath)).rejects.toThrow()
    await expect(fs.access(unsyncedPath)).resolves.toBeUndefined()
  })
})
