import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('conf', () => ({
  default: class {
    get(): unknown {
      return undefined
    }
    set(): void {}
    has(): boolean {
      return false
    }
    delete(): void {}
  }
}))

describe('SessionManager close hooks', () => {
  const ids: string[] = []

  afterEach(async () => {
    const { SessionManager } = await import('./SessionManager')
    const sessions = (SessionManager.getInstance() as unknown as { sessions: Map<string, unknown> }).sessions
    ids.splice(0).forEach((id) => sessions.delete(id))
  })

  async function setup(id: string) {
    const { SessionManager } = await import('./SessionManager')
    const manager = SessionManager.getInstance()
    const internals = manager as unknown as {
      sessions: Map<string, unknown>
      closeHooks: { pre: unknown[]; post: unknown[] }
      handleUnexpectedClose: (sessionId: string, entry: unknown) => void
    }
    const hooks = { pre: internals.closeHooks.pre.length, post: internals.closeHooks.post.length }
    const entry = {
      sessionId: id, siteId: null, status: 'connected',
      client: { end: vi.fn(), destroy: vi.fn() },
      jumpClients: [{ end: vi.fn(), destroy: vi.fn() }],
      abort: vi.fn()
    }
    internals.sessions.set(id, entry)
    ids.push(id)
    const restore = (): void => {
      internals.closeHooks.pre.length = hooks.pre
      internals.closeHooks.post.length = hooks.post
    }
    return { manager, internals, entry, restore }
  }

  it('runs pre hooks while status is connected and post hooks after, on close()', async () => {
    const { manager, entry, restore } = await setup('hooks-close')
    const seen: string[] = []
    manager.onSessionClosed('pre', () => seen.push(`pre:${entry.status}`))
    manager.onSessionClosed('post', () => seen.push(`post:${entry.status}`))
    try {
      manager.close('hooks-close')
      expect(seen).toEqual(['pre:connected', 'post:disconnected'])
    } finally {
      restore()
    }
  })

  it('runs every hook and clears prompts on unexpected close even when one throws', async () => {
    const { manager, internals, entry, restore } = await setup('hooks-unexpected')
    const clear = vi.spyOn(manager as unknown as { clearPendingPrompts: (id: string) => void }, 'clearPendingPrompts')
    const seen: string[] = []
    manager.onSessionClosed('pre', () => {
      throw new Error('pre failed')
    })
    manager.onSessionClosed('post', () => {
      throw new Error('post failed')
    })
    manager.onSessionClosed('post', (id) => seen.push(id))
    try {
      internals.handleUnexpectedClose('hooks-unexpected', entry)
      expect(seen).toEqual(['hooks-unexpected'])
      expect(entry.status).toBe('error')
      expect(clear).toHaveBeenCalledWith('hooks-unexpected')
      expect(entry.jumpClients[0].end).toHaveBeenCalledTimes(1)
    } finally {
      clear.mockRestore()
      restore()
    }
  })
})
