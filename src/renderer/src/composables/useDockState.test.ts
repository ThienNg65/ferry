import { describe, expect, it } from 'vitest'
import { useDockState } from './useDockState'

describe('useDockState', () => {
  it('starts collapsed and openDock expands onto the requested tab', () => {
    const dock = useDockState()
    expect(dock.collapsed.value).toBe(true)
    dock.openDock('tail')
    expect(dock.collapsed.value).toBe(false)
    expect(dock.tab.value).toBe('tail')
  })
})
