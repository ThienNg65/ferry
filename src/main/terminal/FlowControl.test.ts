import { describe, expect, it, vi } from 'vitest'
import { FlowControl } from './FlowControl'

describe('FlowControl', () => {
  it('pauses above the high watermark and resumes below the low watermark', () => {
    const pause = vi.fn()
    const resume = vi.fn()
    const flow = new FlowControl(pause, resume, 100, 20)
    flow.sent(60)
    expect(pause).not.toHaveBeenCalled()
    flow.sent(60)
    expect(pause).toHaveBeenCalledTimes(1)
    flow.sent(10)
    expect(pause).toHaveBeenCalledTimes(1)
    flow.ack(100)
    expect(resume).not.toHaveBeenCalled()
    flow.ack(30)
    expect(resume).toHaveBeenCalledTimes(1)
  })

  it('never goes negative on a surplus ack', () => {
    const resume = vi.fn()
    const flow = new FlowControl(vi.fn(), resume, 10, 5)
    flow.ack(50)
    flow.sent(11)
    flow.ack(11)
    expect(resume).toHaveBeenCalledTimes(1)
  })
})
