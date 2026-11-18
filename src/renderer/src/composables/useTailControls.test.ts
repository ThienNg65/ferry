import { afterEach, describe, expect, it, vi } from 'vitest'
import { tailControls, type TailControls } from './useTailControls'

function makeControls(overrides: Partial<TailControls> = {}): TailControls {
  return {
    tailId: 'tail-1',
    status: 'streaming',
    ended: false,
    error: undefined,
    autoScroll: true,
    newLinesCount: 0,
    linesPerSec: 0,
    visibleCount: 0,
    totalCount: 0,
    bufferPct: 0,
    maxLines: 5000,
    restarting: false,
    menuItems: [],
    toggleAutoScroll: vi.fn(),
    restart: vi.fn(),
    ...overrides
  }
}

describe('useTailControls', () => {
  afterEach(() => {
    tailControls.value = null
  })

  it('starts null and publishes active viewer controls including readiness status', () => {
    expect(tailControls.value).toBeNull()

    const connecting = makeControls({ tailId: 'tail-1', status: 'connecting' })
    tailControls.value = connecting
    expect(tailControls.value).toStrictEqual(connecting)
    expect(tailControls.value?.status).toBe('connecting')
  })

  it('allows swapping controls between active tabs and clearing only matching owner', () => {
    const first = makeControls({ tailId: 'tail-1', status: 'streaming' })
    const second = makeControls({ tailId: 'tail-2', status: 'ended', ended: true })

    tailControls.value = first
    tailControls.value = second

    // Simulating first viewer releasing after second already claimed tailControls
    if (tailControls.value?.tailId === 'tail-1') {
      tailControls.value = null
    }
    expect(tailControls.value?.tailId).toBe('tail-2')

    if (tailControls.value?.tailId === 'tail-2') {
      tailControls.value = null
    }
    expect(tailControls.value).toBeNull()
  })
})
