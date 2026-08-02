import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { TransferEvent, OperationEvent } from '../../shared/contract'
import type { TransferJob } from '../transfer/TransferQueue'

/**
 * HistoryRecorder just wires two singletons' `onTerminalEvent` hooks into a
 * third (HistoryStore.record). Rather than exercising real TransferQueue/
 * OperationRegistry/SessionManager/SiteStore machinery, each is replaced with
 * a minimal fake that captures the registered listener so tests can invoke it
 * directly with a hand-built event — matching how HistoryRecorder.ts itself
 * only ever touches these classes through `getInstance()` and the listed
 * methods.
 */
let transferListener: ((job: TransferJob, evt: TransferEvent) => void) | undefined
let operationListener: ((evt: OperationEvent) => void) | undefined
const recordMock = vi.fn()
let siteIdForSessionResult: string | null = null
const getRawMock = vi.fn()

vi.mock('../transfer/TransferQueue', () => ({
  TransferQueue: {
    getInstance: () => ({
      onTerminalEvent: (cb: (job: TransferJob, evt: TransferEvent) => void) => {
        transferListener = cb
      }
    })
  }
}))

vi.mock('../operations/OperationRegistry', () => ({
  OperationRegistry: {
    getInstance: () => ({
      onTerminalEvent: (cb: (evt: OperationEvent) => void) => {
        operationListener = cb
      }
    })
  }
}))

vi.mock('../ssh/SessionManager', () => ({
  SessionManager: {
    getInstance: () => ({
      siteIdForSession: (_sessionId: string) => siteIdForSessionResult
    })
  }
}))

vi.mock('../sites/SiteStore', () => ({
  SiteStore: {
    getInstance: () => ({
      getRaw: getRawMock
    })
  }
}))

vi.mock('./HistoryStore', () => ({
  HistoryStore: {
    getInstance: () => ({
      record: recordMock
    })
  }
}))

const { initHistoryRecorder } = await import('./HistoryRecorder')

function transferJob(overrides: Partial<TransferJob> = {}): TransferJob {
  return {
    transferId: 't1',
    sessionId: 's1',
    kind: 'upload',
    localPath: 'C:\\local\\report.pdf',
    remotePath: '/remote/report.pdf',
    controller: new AbortController(),
    isTree: false,
    queuedAt: 1000,
    ...overrides
  }
}

describe('HistoryRecorder', () => {
  beforeEach(() => {
    recordMock.mockClear()
    getRawMock.mockReset()
    siteIdForSessionResult = 's1'
    initHistoryRecorder()
  })

  it('registers exactly one listener with each of TransferQueue and OperationRegistry, only once even if called again', () => {
    initHistoryRecorder()
    initHistoryRecorder()
    expect(transferListener).toEqual(expect.any(Function))
    expect(operationListener).toEqual(expect.any(Function))
  })

  it('records a completed upload as a transfer history entry with a derived label and resolved site name', () => {
    getRawMock.mockReturnValue({ name: 'Prod Site' })
    const job = transferJob({ kind: 'upload', localPath: 'C:\\local\\report.pdf' })
    const evt: TransferEvent = { transferId: 't1', kind: 'upload', state: 'done', bytesTransferred: 1234 }

    transferListener!(job, evt)

    expect(recordMock).toHaveBeenCalledTimes(1)
    const recorded = recordMock.mock.calls[0][0]
    expect(recorded).toMatchObject({
      kind: 'transfer',
      label: 'Upload report.pdf',
      direction: 'upload',
      sessionId: 's1',
      siteName: 'Prod Site',
      bytes: 1234,
      startedAt: 1000,
      status: 'done'
    })
  })

  it('derives a Download label with the remote basename for downloads', () => {
    getRawMock.mockReturnValue({ name: 'Prod Site' })
    const job = transferJob({ kind: 'download', remotePath: '/remote/dir/data.csv' })
    const evt: TransferEvent = { transferId: 't1', kind: 'download', state: 'error', error: 'connection reset' }

    transferListener!(job, evt)

    const recorded = recordMock.mock.calls[0][0]
    expect(recorded.label).toBe('Download data.csv')
    expect(recorded.status).toBe('error')
    expect(recorded.error).toBe('connection reset')
  })

  it('leaves siteName undefined when the job has no sessionId', () => {
    const job = transferJob({ sessionId: undefined as unknown as string })
    const evt: TransferEvent = { transferId: 't1', kind: 'upload', state: 'cancelled' }

    transferListener!(job, evt)

    expect(getRawMock).not.toHaveBeenCalled()
    expect(recordMock.mock.calls[0][0].siteName).toBeUndefined()
  })

  it('leaves siteName undefined when the session has no resolvable site', () => {
    siteIdForSessionResult = null
    const job = transferJob()
    transferListener!(job, { transferId: 't1', kind: 'upload', state: 'done' })

    expect(getRawMock).not.toHaveBeenCalled()
    expect(recordMock.mock.calls[0][0].siteName).toBeUndefined()
  })

  it('records a completed operation as an operation history entry', () => {
    getRawMock.mockReturnValue({ name: 'Staging' })
    const evt: OperationEvent = {
      operationId: 'op1',
      kind: 'extract-remote',
      state: 'done',
      label: 'Extracting archive.zip',
      sessionId: 's1',
      startedAt: 5000,
      cancellable: true
    }

    operationListener!(evt)

    expect(recordMock).toHaveBeenCalledTimes(1)
    const recorded = recordMock.mock.calls[0][0]
    expect(recorded).toMatchObject({
      kind: 'operation',
      label: 'Extracting archive.zip',
      operationKind: 'extract-remote',
      sessionId: 's1',
      siteName: 'Staging',
      startedAt: 5000,
      status: 'done'
    })
  })

  it('records an operation error with its error message', () => {
    const evt: OperationEvent = {
      operationId: 'op2',
      kind: 'compress-local',
      state: 'error',
      label: 'Compressing folder',
      startedAt: 5000,
      cancellable: false,
      error: 'disk full'
    }

    operationListener!(evt)

    const recorded = recordMock.mock.calls[0][0]
    expect(recorded.sessionId).toBeUndefined()
    expect(recorded.status).toBe('error')
    expect(recorded.error).toBe('disk full')
  })
})
