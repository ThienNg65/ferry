import { EventEmitter } from 'node:events'
import type { Client, ClientChannel } from 'ssh2'
import { describe, expect, it } from 'vitest'
import { MAX_BUFFERED_LINE_BYTES, TRUNCATED_LINE_SUFFIX } from './BoundedLineBuffer'
import { RemoteShell } from './RemoteShell'

class MockChannel extends EventEmitter {
  readonly stderr = new EventEmitter()

  end(_input?: Buffer): void {
    this.emit('finish')
  }

  destroy(): void {
    this.emit('close')
  }
}

function createHarness(): { shell: RemoteShell; channel: MockChannel } {
  const channel = new MockChannel()
  const client = {
    exec: (_command: string, callback: (error: Error | undefined, stream: ClientChannel) => void): void => {
      callback(undefined, channel as unknown as ClientChannel)
    }
  } as unknown as Client

  return { shell: new RemoteShell(client), channel }
}

function splitBuffer(value: string, split: number): [Buffer, Buffer] {
  const bytes = Buffer.from(value)
  return [bytes.subarray(0, split), bytes.subarray(split)]
}

const utf8Cases = ['é', '€', '😀'].flatMap((value) => {
  const byteLength = Buffer.byteLength(value)
  return Array.from({ length: byteLength - 1 }, (_, index) => ({
    value,
    split: index + 1
  }))
})

describe('RemoteShell UTF-8 output', () => {
  it.each(utf8Cases)('exec preserves split UTF-8 for $value at byte $split', async ({ value, split }) => {
    const { shell, channel } = createHarness()
    const execution = shell.exec('printf output')
    const [first, second] = splitBuffer(value, split)

    channel.emit('data', first)
    channel.emit('data', second)
    channel.stderr.emit('data', first)
    channel.stderr.emit('data', second)
    channel.emit('close', 0)

    await expect(execution).resolves.toEqual({ stdout: value, stderr: value, code: 0 })
  })

  it.each(utf8Cases)('execWithStdin preserves split UTF-8 for $value at byte $split', async ({ value, split }) => {
    const { shell, channel } = createHarness()
    const execution = shell.execWithStdin('cat', Buffer.from('input'))
    const [first, second] = splitBuffer(value, split)

    channel.stderr.emit('data', first)
    channel.stderr.emit('data', second)
    channel.emit('close', 0)

    await expect(execution).resolves.toEqual({
      stdout: Buffer.alloc(0),
      stderr: value,
      code: 0
    })
  })

  it.each(utf8Cases)('execLines preserves split UTF-8 for $value at byte $split', async ({ value, split }) => {
    const { shell, channel } = createHarness()
    const lines: string[] = []
    const stderr: string[] = []
    const stdoutText = 'before' + value + 'after\n'
    const stderrText = 'error' + value + 'end'
    const [stdoutFirst, stdoutSecond] = splitBuffer(stdoutText, Buffer.byteLength('before') + split)
    const [stderrFirst, stderrSecond] = splitBuffer(stderrText, Buffer.byteLength('error') + split)
    const execution = shell.execLines('tail -f output', {
      timeoutMs: null,
      onLine: (line) => lines.push(line),
      onStderr: (chunk) => stderr.push(chunk)
    })

    channel.emit('data', stdoutFirst)
    channel.emit('data', stdoutSecond)
    channel.stderr.emit('data', stderrFirst)
    channel.stderr.emit('data', stderrSecond)
    channel.emit('close', 0)

    await expect(execution).resolves.toBe(0)
    expect(lines).toEqual(['before' + value + 'after'])
    expect(stderr.join('')).toBe(stderrText)
  })

  it('bounds chunked unterminated stdout lines and resumes after the next newline', async () => {
    const { shell, channel } = createHarness()
    const lines: string[] = []
    const execution = shell.execLines('tail -f output', {
      timeoutMs: null,
      onLine: (line) => lines.push(line)
    })
    const chunk = 'x'.repeat(16 * 1024)

    for (let index = 0; index < 5; index++) {
      channel.emit('data', Buffer.from(chunk))
    }
    expect(lines).toEqual([])

    channel.emit('data', Buffer.from('\nnext line\n'))
    channel.emit('close', 0)

    await expect(execution).resolves.toBe(0)
    expect(lines).toEqual([
      'x'.repeat(MAX_BUFFERED_LINE_BYTES) + TRUNCATED_LINE_SUFFIX,
      'next line'
    ])
  })

  it('flushes incomplete UTF-8 sequences consistently when each command closes', async () => {
    const incomplete = Buffer.from([0xe2])

    const buffered = createHarness()
    const bufferedExecution = buffered.shell.exec('printf output')
    buffered.channel.emit('data', incomplete)
    buffered.channel.stderr.emit('data', incomplete)
    buffered.channel.emit('close', 0)
    await expect(bufferedExecution).resolves.toEqual({ stdout: '�', stderr: '�', code: 0 })

    const withStdin = createHarness()
    const stdinExecution = withStdin.shell.execWithStdin('cat', Buffer.from('input'))
    withStdin.channel.stderr.emit('data', incomplete)
    withStdin.channel.emit('close', 0)
    await expect(stdinExecution).resolves.toEqual({
      stdout: Buffer.alloc(0),
      stderr: '�',
      code: 0
    })

    const streamed = createHarness()
    const lines: string[] = []
    const stderr: string[] = []
    const streamExecution = streamed.shell.execLines('tail -f output', {
      timeoutMs: null,
      onLine: (line) => lines.push(line),
      onStderr: (chunk) => stderr.push(chunk)
    })
    streamed.channel.emit('data', incomplete)
    streamed.channel.stderr.emit('data', incomplete)
    streamed.channel.emit('close', 0)
    await expect(streamExecution).resolves.toBe(0)
    expect(lines).toEqual(['�'])
    expect(stderr.join('')).toBe('�')
  })
})
