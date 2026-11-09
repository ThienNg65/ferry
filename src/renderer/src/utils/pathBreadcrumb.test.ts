import { describe, expect, it } from 'vitest'
import { parseBreadcrumbSegments } from './pathBreadcrumb'

describe('parseBreadcrumbSegments', () => {
  it('handles POSIX root path', () => {
    expect(parseBreadcrumbSegments('/')).toEqual([{ label: '/', fullPath: '/' }])
    expect(parseBreadcrumbSegments('')).toEqual([{ label: '/', fullPath: '/' }])
  })

  it('splits nested POSIX paths into cumulative segments', () => {
    expect(parseBreadcrumbSegments('/var/log/nginx')).toEqual([
      { label: '/', fullPath: '/' },
      { label: 'var', fullPath: '/var' },
      { label: 'log', fullPath: '/var/log' },
      { label: 'nginx', fullPath: '/var/log/nginx' }
    ])
  })

  it('strips trailing slashes on POSIX paths', () => {
    expect(parseBreadcrumbSegments('/home/deploy/')).toEqual([
      { label: '/', fullPath: '/' },
      { label: 'home', fullPath: '/home' },
      { label: 'deploy', fullPath: '/home/deploy' }
    ])
  })

  it('splits Windows drive and folder paths', () => {
    expect(parseBreadcrumbSegments('C:\\')).toEqual([{ label: 'C:\\', fullPath: 'C:\\' }])
    expect(parseBreadcrumbSegments('C:\\Users\\thien\\Projects')).toEqual([
      { label: 'C:\\', fullPath: 'C:\\' },
      { label: 'Users', fullPath: 'C:\\Users' },
      { label: 'thien', fullPath: 'C:\\Users\\thien' },
      { label: 'Projects', fullPath: 'C:\\Users\\thien\\Projects' }
    ])
  })
})
