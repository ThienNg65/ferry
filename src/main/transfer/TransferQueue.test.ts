import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransferEvent } from '../../shared/contract'

const broadcast = vi.fn()
const sessionManager = {
  transferIdentity: vi.fn(() => 'identity-1'),
  connectedTransferSession: vi.fn((sessionId: string) => sessionId as string | null),
  shell: vi.fn(() => ({ unlink: vi.fn().mockResolvedValue(undefined) }))
}
const heldStats: Array<() => void> = []

vi.mock('../host/host', () => ({ host: () => ({ broadcast }) }))
vi.mock('../ssh/SessionManager', () => ({ SessionManager: { getInstance: () => sessionManager } }))
vi.mock('fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('fs/promises')>()),
  stat: vi.fn(() => new Promise((_, reject) => heldStats.push(() => reject(new Error('stat released')))))
}))

import { TransferQueue } from './TransferQueue'

function states(): string[] {
  return broadcast.mock.calls.map((call) => (call[1] as TransferEvent).state)
}

function eventsFor(id: string): TransferEvent[] {
  return broadcast.mock.calls.map((call) => call[1] as TransferEvent).filter((evt) => evt.transferId === id)
}

describe('TransferQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    heldStats.length = 0
    sessionManager.connectedTransferSession.mockImplementation((sessionId: string) => sessionId)
  })

  it('runs at most three transfers at once and keeps the rest queued', () => {
    const queue = new TransferQueue()
    const ids = [1, 2, 3, 4].map((n) => queue.enqueue('s1', 'upload', `/l/${n}`, `/r/${n}`))
    expect(states().filter((s) => s === 'started')).toHaveLength(3)
    expect(eventsFor(ids[3]).map((e) => e.state)).toEqual(['queued'])
  })

  it('cancels a queued transfer into a restart-required terminal event', () => {
    const queue = new TransferQueue()
    const listener = vi.fn()
    queue.onTerminalEvent(listener)
    const ids = [1, 2, 3, 4].map((n) => queue.enqueue('s1', 'upload', `/l/${n}`, `/r/${n}`))
    queue.cancel(ids[3])
    const last = eventsFor(ids[3]).at(-1)
    expect(last).toMatchObject({ state: 'cancelled', restartRequired: true })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('a throwing terminal listener never breaks cancellation', () => {
    const queue = new TransferQueue()
    queue.onTerminalEvent(() => {
      throw new Error('history write failed')
    })
    const ids = [1, 2, 3, 4].map((n) => queue.enqueue('s1', 'upload', `/l/${n}`, `/r/${n}`))
    expect(() => queue.cancel(ids[3])).not.toThrow()
  })

  it('pauses a queued transfer and reports it as paused and retryable', () => {
    const queue = new TransferQueue()
    const ids = [1, 2, 3, 4].map((n) => queue.enqueue('s1', 'upload', `/l/${n}`, `/r/${n}`))
    queue.pause(ids[3])
    expect(eventsFor(ids[3]).at(-1)?.state).toBe('paused')
    expect(() => queue.retry(ids[3])).not.toThrow()
    expect(eventsFor(ids[3]).at(-1)?.state).toBe('queued')
  })

  it('rejects retry of an unknown transfer with NOT_FOUND', () => {
    const queue = new TransferQueue()
    expect(() => queue.retry('nope')).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }))
  })

  it('requires an explicit restart to retry a cancelled transfer', () => {
    const queue = new TransferQueue()
    const ids = [1, 2, 3, 4].map((n) => queue.enqueue('s1', 'upload', `/l/${n}`, `/r/${n}`))
    queue.cancel(ids[3])
    expect(() => queue.retry(ids[3])).toThrow()
    expect(() => queue.retry(ids[3], true)).not.toThrow()
    expect(eventsFor(ids[3]).at(-1)).toMatchObject({ state: 'queued', bytesTransferred: 0 })
  })

  it('refuses to retry once the original connection is gone', () => {
    const queue = new TransferQueue()
    const ids = [1, 2, 3, 4].map((n) => queue.enqueue('s1', 'upload', `/l/${n}`, `/r/${n}`))
    queue.pause(ids[3])
    sessionManager.connectedTransferSession.mockReturnValue(null)
    expect(() => queue.retry(ids[3])).toThrowError(expect.objectContaining({ code: 'SSH_CONNECT' }))
  })

  it('reports a failed run as a retryable error', async () => {
    const queue = new TransferQueue()
    const id = queue.enqueue('s1', 'upload', '/l/a', '/r/a')
    heldStats.forEach((release) => release())
    await vi.waitFor(() => expect(eventsFor(id).at(-1)?.state).toBe('error'))
    expect(eventsFor(id).at(-1)?.error).toBe('stat released')
  })
})
