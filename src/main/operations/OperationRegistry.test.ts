import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The registry broadcasts via BrowserWindow.getAllWindows() — vitest runs
// outside a real Electron process, so mock only that (standard pattern, see
// PROJECT_MAP "Build / run / test").
const sent: unknown[] = []
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { send: (_channel: string, evt: unknown) => sent.push(evt) }
      }
    ]
  }
}))

import { OperationRegistry } from './OperationRegistry'
import { SshError } from '../ssh/errors'
import type { OperationEvent } from '../../shared/contract'

const META = { kind: 'extract-remote' as const, label: 'Extracting x.zip', sessionId: 's1', cancellable: true }

function events(): OperationEvent[] {
  return sent as OperationEvent[]
}

describe('OperationRegistry', () => {
  beforeEach(() => {
    sent.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves the wrapped function value and emits started → done', async () => {
    const registry = OperationRegistry.getInstance()
    const result = await registry.run(META, async () => 'value')
    expect(result).toBe('value')
    expect(events().map((e) => e.state)).toEqual(['started', 'done'])
    expect(events()[0].label).toBe('Extracting x.zip')
    expect(events()[0].cancellable).toBe(true)
    expect(events()[0].startedAt).toBeGreaterThan(0)
  })

  it('rethrows failures and emits error with the message', async () => {
    const registry = OperationRegistry.getInstance()
    await expect(registry.run(META, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(events().map((e) => e.state)).toEqual(['started', 'error'])
    expect(events()[1].error).toBe('boom')
  })

  it('maps an SshError CANCELLED rejection to the cancelled state', async () => {
    const registry = OperationRegistry.getInstance()
    await expect(
      registry.run(META, async () => Promise.reject(new SshError('CANCELLED', 'Operation cancelled')))
    ).rejects.toThrow()
    expect(events().map((e) => e.state)).toEqual(['started', 'cancelled'])
    expect(events()[1].error).toBeUndefined()
  })

  it('cancel() aborts the signal handed to the running function', async () => {
    const registry = OperationRegistry.getInstance()
    const run = registry.run(META, async ({ signal }) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new SshError('CANCELLED', 'aborted')))
      })
    })
    const operationId = events()[0].operationId
    registry.cancel(operationId)
    await expect(run).rejects.toThrow()
    expect(events().at(-1)?.state).toBe('cancelled')
  })

  it('cancel() on an unknown id is a no-op', () => {
    expect(() => OperationRegistry.getInstance().cancel('nope')).not.toThrow()
  })

  it('cancelAllForSession aborts only matching operations', async () => {
    const registry = OperationRegistry.getInstance()
    const hang = (signal: AbortSignal): Promise<void> =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new SshError('CANCELLED', 'aborted')))
        setTimeout(resolve, 50)
      })
    const a = registry.run({ ...META, sessionId: 'sA' }, ({ signal }) => hang(signal))
    const b = registry.run({ ...META, sessionId: 'sB' }, ({ signal }) => hang(signal))
    registry.cancelAllForSession('sA')
    await expect(a).rejects.toThrow()
    await expect(b).resolves.toBeUndefined()
    const states = events().map((e) => [e.sessionId, e.state])
    expect(states).toContainEqual(['sA', 'cancelled'])
    expect(states).toContainEqual(['sB', 'done'])
  })

  it('throttles progress to one emit per 200ms window, always letting the final emit through', async () => {
    vi.useFakeTimers()
    const registry = OperationRegistry.getInstance()
    await registry.run(META, async ({ reportProgress }) => {
      reportProgress(1, 10, 'items') // emitted (first)
      reportProgress(2, 10, 'items') // dropped (<200ms)
      vi.advanceTimersByTime(250)
      reportProgress(3, 10, 'items') // emitted
      reportProgress(10, 10, 'items') // emitted despite throttle — final
    })
    const progress = events().filter((e) => e.state === 'progress')
    expect(progress.map((e) => e.progressCurrent)).toEqual([1, 3, 10])
    expect(progress[0].progressUnit).toBe('items')
  })
})
