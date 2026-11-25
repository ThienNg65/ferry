import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client } from 'ssh2'
import { INVOKE_CHANNELS, type IpcResult } from '../../shared/contract'
import { handlers } from '../ipc/envelope'
import { registerOperationsHandlers } from '../ipc/operations.ipc'
import { registerSyncHandlers } from '../ipc/sync.ipc'
import { RemoteShell } from '../ssh/RemoteShell'
import { backupUserDataBeforeUpgrade } from '../update/SidecarUpdater'
import { logAppEvent } from './appLog'
import { setHost } from './host'
import { openSafeConf } from './storeHelpers'

describe('reliability hardening', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'ferry-reliability-'))
    setHost({
      broadcast: vi.fn(),
      isEncryptionAvailable: () => true,
      encrypt: (s) => s,
      decrypt: (s) => s,
      dataDir: tmpDir,
      isPackaged: false,
      appVersion: '1.0.0',
      openPath: async () => '',
      pickOpenFile: async () => null
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('openSafeConf logs corrupt JSON without erasing the file and runs versioned migrations with backup', () => {
    const corruptRaw = '{not valid json'
    writeFileSync(path.join(tmpDir, 'sites.json'), corruptRaw, 'utf8')
    expect(() =>
      openSafeConf<{ schemaVersion?: number; items: string[] }>({
        cwd: tmpDir,
        configName: 'sites',
        defaults: { schemaVersion: 1, items: [] },
        schemaVersion: 1
      })
    ).toThrow(SyntaxError)
    expect(readFileSync(path.join(tmpDir, 'sites.json'), 'utf8')).toBe(corruptRaw)
    expect(readFileSync(path.join(tmpDir, 'app.log'), 'utf8')).toContain('store.corrupt_json')

    writeFileSync(path.join(tmpDir, 'legacy.json'), JSON.stringify({ items: ['a'] }), 'utf8')
    const migrated = openSafeConf<{ schemaVersion?: number; items: string[] }>({
      cwd: tmpDir,
      configName: 'legacy',
      defaults: { schemaVersion: 1, items: [] },
      schemaVersion: 1,
      migrate: (s) => s.set('items', [...s.get('items'), 'migrated'])
    })
    expect(migrated.get('schemaVersion')).toBe(1)
    expect(migrated.get('items')).toEqual(['a', 'migrated'])
    expect(existsSync(path.join(tmpDir, 'legacy.v0.bak.json'))).toBe(true)
  })

  it('logAppEvent and IPC envelope redact secrets and record failed channel metadata', async () => {
    logAppEvent('info', 'test.event', { password: 'secret-value', host: 'example.com' })
    handlers.clear()
    registerOperationsHandlers()
    registerSyncHandlers()

    const cancelRes = (await handlers.get(INVOKE_CHANNELS.operationCancel)!({}, '')) as IpcResult<unknown>
    expect(cancelRes).toMatchObject({ ok: false, code: 'VALIDATION' })

    const syncRes = (await handlers.get(INVOKE_CHANNELS.syncPreview)!({}, { sessionId: '' })) as IpcResult<unknown>
    expect(syncRes).toMatchObject({ ok: false, code: 'VALIDATION' })

    const logText = readFileSync(path.join(tmpDir, 'app.log'), 'utf8')
    expect(logText).not.toContain('secret-value')
    expect(logText).toContain('"[REDACTED]"')
    expect(logText).toContain(INVOKE_CHANNELS.operationCancel)
    expect(logText).toContain('"durationMs":')
  })

  it('backupUserDataBeforeUpgrade copies config files and retains only the newest 3 backups chronologically', () => {
    writeFileSync(path.join(tmpDir, 'sites.json'), '{"sites":[]}', 'utf8')
    const backupsRoot = path.join(tmpDir, 'upgrade-backups')
    mkdirSync(path.join(backupsRoot, 'v0.9.0-1000'), { recursive: true })
    mkdirSync(path.join(backupsRoot, 'v0.10.0-2000'), { recursive: true })
    mkdirSync(path.join(backupsRoot, 'v0.11.0-3000'), { recursive: true })

    const dest = backupUserDataBeforeUpgrade(tmpDir, '0.12.0')
    expect(dest).not.toBeNull()
    expect(existsSync(path.join(dest!, 'sites.json'))).toBe(true)
    const remaining = readdirSync(backupsRoot)
    expect(remaining).toHaveLength(3)
    expect(remaining).not.toContain('v0.9.0-1000')
    expect(remaining).toContain('v0.10.0-2000')
  })

  it('RemoteShell.sftp() rejects with SSH_TIMEOUT when SFTP subsystem hangs', async () => {
    vi.useFakeTimers()
    const fakeClient = {
      sftp: vi.fn()
    } as unknown as Client
    const shell = new RemoteShell(fakeClient)

    const promise = shell.sftp()
    const assertion = expect(promise).rejects.toMatchObject({ code: 'SSH_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
  })
})
