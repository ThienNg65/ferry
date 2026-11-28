import { afterEach, describe, expect, it } from 'vitest'
import { isStoreManaged } from './distribution'

describe('isStoreManaged', () => {
  const prev = process.env['FERRY_DISTRIBUTION']
  afterEach(() => {
    if (prev === undefined) delete process.env['FERRY_DISTRIBUTION']
    else process.env['FERRY_DISTRIBUTION'] = prev
  })

  it('is false for a plain dev/direct install', () => {
    delete process.env['FERRY_DISTRIBUTION']
    delete process.env['FERRY_STORE_BUILD']
    expect(isStoreManaged()).toBe(false)
  })

  it('is true when FERRY_DISTRIBUTION=mas', () => {
    process.env['FERRY_DISTRIBUTION'] = 'mas'
    expect(isStoreManaged()).toBe(true)
  })
})
