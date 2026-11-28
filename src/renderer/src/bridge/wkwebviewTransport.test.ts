// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { createWKWebViewTransport } from './wkwebviewTransport'

function setup() {
  const posted: Array<{ id: number; op: string; args?: unknown }> = []
  const transport = createWKWebViewTransport({ postMessage: (m) => posted.push(m as never) })
  transport.init()
  return { transport, posted }
}

describe('wkwebviewTransport', () => {
  it('resolves a call when the shell replies', async () => {
    const { transport, posted } = setup()
    const p = transport.showFolderDialog('Pick', { defaultPath: '/tmp' })
    const call = posted.find((m) => m.op === 'dialog.folder')!
    expect(call.args).toEqual({ title: 'Pick', defaultPath: '/tmp' })
    window.__ferryNative!.reply(call.id, '/Users/x/dir')
    await expect(p).resolves.toBe('/Users/x/dir')
  })

  it('rejects when the shell replies with an error', async () => {
    const { transport, posted } = setup()
    const p = transport.readClipboardText()
    window.__ferryNative!.reply(posted.at(-1)!.id, null, 'denied')
    await expect(p).rejects.toThrow('denied')
  })

  it('delivers pushed events and supports unsubscribe', () => {
    const { transport } = setup()
    const handler = vi.fn()
    const off = transport.onEvent('rpc_event', handler)
    window.__ferryNative!.emit('rpc_event', { channel: 'c', payload: 1 })
    off()
    window.__ferryNative!.emit('rpc_event', { channel: 'c', payload: 2 })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ channel: 'c', payload: 1 })
  })

  it('forwards sidecar dispatches', async () => {
    const { transport, posted } = setup()
    const p = transport.dispatchExtension('js.ferry.sidecar', 'rpc_invoke', { id: 'nl-1' })
    const call = posted.find((m) => m.op === 'sidecar')!
    expect(call.args).toEqual({ event: 'rpc_invoke', data: { id: 'nl-1' } })
    window.__ferryNative!.reply(call.id, null)
    await expect(p).resolves.toBeUndefined()
  })

  it('resolves dropped files to host paths announced by the shell', () => {
    const { transport } = setup()
    window.__ferryNative!.setDropFiles([
      { name: 'a.txt', path: '/Users/x/a.txt', size: 3, mtime: 1000, isDir: false },
      { name: 'b.txt', path: '/Users/x/b.txt', size: 4, mtime: 2000, isDir: false },
      { name: 'b.txt', path: '/Users/y/b.txt', size: 9, mtime: 3000, isDir: false }
    ])
    const file = (name: string, size: number, mtime: number) =>
      ({ name, size, lastModified: mtime }) as unknown as File
    expect(transport.pathForFile!(file('a.txt', 99, 1))).toBe('/Users/x/a.txt')
    expect(transport.pathForFile!(file('b.txt', 9, 3000))).toBe('/Users/y/b.txt')
    expect(transport.pathForFile!(file('b.txt', 1, 1))).toBe('')
    expect(transport.pathForFile!(file('zzz', 1, 1))).toBe('')
  })
})
