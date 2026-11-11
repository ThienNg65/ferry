import { describe, expect, it } from 'vitest'
import { emptyHistory, recordVisit, stepBack, stepForward } from './navHistory'

describe('navHistory', () => {
  it('records visits, steps back and forward, and clears forward on a new visit', () => {
    let h = recordVisit(recordVisit(emptyHistory(), '/a'), '/a/b')
    const back = stepBack(h, '/a/b/c')
    expect(back?.target).toBe('/a/b')
    h = back!.next
    expect(h).toEqual({ back: ['/a'], fwd: ['/a/b/c'] })
    const fwd = stepForward(h, '/a/b')
    expect(fwd?.target).toBe('/a/b/c')
    expect(fwd!.next).toEqual({ back: ['/a', '/a/b'], fwd: [] })
    expect(recordVisit(h, '/x').fwd).toEqual([])
  })

  it('returns null when there is nothing to step to', () => {
    expect(stepBack(emptyHistory(), '/')).toBeNull()
    expect(stepForward(emptyHistory(), '/')).toBeNull()
  })

  it('caps the back stack', () => {
    let h = emptyHistory()
    for (let i = 0; i < 150; i++) h = recordVisit(h, `/d${i}`)
    expect(h.back).toHaveLength(100)
    expect(h.back[99]).toBe('/d149')
  })
})
