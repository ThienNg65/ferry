import { describe, expect, it } from 'vitest'
import { collapseBreadcrumbSegments, parseBreadcrumbSegments } from '../pathBreadcrumb'

describe('pathBreadcrumb', () => {
  it('keeps root-only POSIX path uncollapsed', () => {
    const result = collapseBreadcrumbSegments(parseBreadcrumbSegments('/'))
    expect(result).toEqual({
      root: { label: '/', fullPath: '/' },
      collapsed: [],
      current: null
    })
  })

  it('keeps two-segment POSIX path uncollapsed', () => {
    const result = collapseBreadcrumbSegments(parseBreadcrumbSegments('/config'))
    expect(result).toEqual({
      root: { label: '/', fullPath: '/' },
      collapsed: [],
      current: { label: 'config', fullPath: '/config' }
    })
  })

  it('collapses middle segments for /home/agent1/Downloads', () => {
    const result = collapseBreadcrumbSegments(parseBreadcrumbSegments('/home/agent1/Downloads'))
    expect(result).toEqual({
      root: { label: '/', fullPath: '/' },
      collapsed: [
        { label: 'home', fullPath: '/home' },
        { label: 'agent1', fullPath: '/home/agent1' }
      ],
      current: { label: 'Downloads', fullPath: '/home/agent1/Downloads' }
    })
  })

  it('collapses deep POSIX paths while preserving root and current folder', () => {
    const result = collapseBreadcrumbSegments(parseBreadcrumbSegments('/config/nested/level-1/level-2/level-3'))
    expect(result).toEqual({
      root: { label: '/', fullPath: '/' },
      collapsed: [
        { label: 'config', fullPath: '/config' },
        { label: 'nested', fullPath: '/config/nested' },
        { label: 'level-1', fullPath: '/config/nested/level-1' },
        { label: 'level-2', fullPath: '/config/nested/level-1/level-2' }
      ],
      current: { label: 'level-3', fullPath: '/config/nested/level-1/level-2/level-3' }
    })
  })

  it('keeps Windows drive root uncollapsed', () => {
    const result = collapseBreadcrumbSegments(parseBreadcrumbSegments('C:\\'))
    expect(result).toEqual({
      root: { label: 'C:\\', fullPath: 'C:\\' },
      collapsed: [],
      current: null
    })
  })

  it('collapses middle segments for Windows paths', () => {
    const result = collapseBreadcrumbSegments(parseBreadcrumbSegments('C:\\Users\\ferry\\Documents'))
    expect(result).toEqual({
      root: { label: 'C:\\', fullPath: 'C:\\' },
      collapsed: [
        { label: 'Users', fullPath: 'C:\\Users' },
        { label: 'ferry', fullPath: 'C:\\Users\\ferry' }
      ],
      current: { label: 'Documents', fullPath: 'C:\\Users\\ferry\\Documents' }
    })
  })
})
