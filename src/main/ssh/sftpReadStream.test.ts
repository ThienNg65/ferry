import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { monitorSftpReadStream } from './sftpReadStream'

afterEach(() => {
  vi.useRealTimers()
})

describe('monitorSftpReadStream', () => {
  it('resolves after end and reports the received byte count', async () => {
    const stream = new PassThrough()
    const onData = vi.fn()
    const completion = monitorSftpReadStream(stream, {
      remotePath: '/srv/file.txt',
      expectedBytes: 5,
      onData
    })

    stream.end('hello')

    await expect(completion).resolves.toBe(5)
    expect(onData).toHaveBeenLastCalledWith(Buffer.from('hello'), 5)
  })

  it('rejects a close before end-of-stream', async () => {
    const stream = new PassThrough()
    const completion = monitorSftpReadStream(stream, { remotePath: '/srv/file.txt' })
    stream.write('partial')
    stream.destroy()

    await expect(completion).rejects.toMatchObject({ code: 'SFTP' })
  })

  it('rejects stream errors', async () => {
    const stream = new PassThrough()
    const completion = monitorSftpReadStream(stream, { remotePath: '/srv/file.txt' })
    stream.destroy(new Error('channel lost'))

    await expect(completion).rejects.toThrow('channel lost')
  })

  it('rejects when the stream ends before the expected byte count', async () => {
    const stream = new PassThrough()
    const completion = monitorSftpReadStream(stream, {
      remotePath: '/srv/file.txt',
      expectedBytes: 6
    })
    stream.end('short')

    await expect(completion).rejects.toThrow('expected 6 bytes but received 5')
  })

  it('rejects when the stream exceeds the expected byte count', async () => {
    const stream = new PassThrough()
    const completion = monitorSftpReadStream(stream, {
      remotePath: '/srv/file.txt',
      expectedBytes: 3
    })
    stream.end('more')

    await expect(completion).rejects.toThrow('exceeded its expected size')
  })

  it('destroys a stream that exceeds its idle-progress deadline', async () => {
    vi.useFakeTimers()
    const stream = new PassThrough()
    const completion = monitorSftpReadStream(stream, {
      remotePath: '/srv/file.txt',
      idleTimeoutMs: 50,
      timeoutMs: 1_000
    })
    const assertion = expect(completion).rejects.toMatchObject({ code: 'SSH_TIMEOUT' })

    await vi.advanceTimersByTimeAsync(51)

    await assertion
    expect(stream.destroyed).toBe(true)
  })

  it('pauses the idle deadline while the consumer applies backpressure', async () => {
    vi.useFakeTimers()
    const stream = new PassThrough()
    const completion = monitorSftpReadStream(stream, {
      remotePath: '/srv/file.txt',
      idleTimeoutMs: 50,
      timeoutMs: 1_000
    })
    let settled = false
    void completion.then(
      () => { settled = true },
      () => { settled = true }
    )

    stream.pause()
    await vi.advanceTimersByTimeAsync(100)
    expect(settled).toBe(false)

    stream.resume()
    const assertion = expect(completion).rejects.toMatchObject({ code: 'SSH_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(51)

    await assertion
    expect(stream.destroyed).toBe(true)
  })

  it('keeps the overall deadline active while the consumer pauses the stream', async () => {
    vi.useFakeTimers()
    const stream = new PassThrough()
    const completion = monitorSftpReadStream(stream, {
      remotePath: '/srv/file.txt',
      idleTimeoutMs: 1_000,
      timeoutMs: 50
    })
    const assertion = expect(completion).rejects.toMatchObject({ code: 'SSH_TIMEOUT' })

    stream.pause()
    await vi.advanceTimersByTimeAsync(51)

    await assertion
    expect(stream.destroyed).toBe(true)
  })

  it('enforces the overall deadline even while data continues to arrive', async () => {
    vi.useFakeTimers()
    const stream = new PassThrough()
    const completion = monitorSftpReadStream(stream, {
      remotePath: '/srv/file.txt',
      idleTimeoutMs: 1_000,
      timeoutMs: 50
    })
    const assertion = expect(completion).rejects.toMatchObject({ code: 'SSH_TIMEOUT' })

    stream.write('a')
    await vi.advanceTimersByTimeAsync(51)

    await assertion
    expect(stream.destroyed).toBe(true)
  })

  it('destroys the stream and rejects when cancelled', async () => {
    const stream = new PassThrough()
    const controller = new AbortController()
    const completion = monitorSftpReadStream(stream, {
      remotePath: '/srv/file.txt',
      signal: controller.signal
    })
    controller.abort()

    await expect(completion).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(stream.destroyed).toBe(true)
  })
})
