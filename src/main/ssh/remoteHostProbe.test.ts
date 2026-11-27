import { describe, expect, it } from 'vitest'
import { formatRemoteOsLabel, parseRemoteHostInfo } from './remoteHostProbe'

describe('remoteHostProbe', () => {
  it('parses Ubuntu Linux with systemd', () => {
    const stdout = [
      'Linux 6.8.0-45-generic x86_64',
      '@@@',
      'NAME="Ubuntu"\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"',
      '@@@',
      '/bin/bash',
      '@@@',
      'systemd'
    ].join('\n')

    const info = parseRemoteHostInfo(stdout)
    expect(info).toEqual({
      os: 'Linux',
      kernel: '6.8.0-45-generic',
      arch: 'x86_64',
      distro: 'Ubuntu 24.04.1 LTS',
      shell: '/bin/bash',
      initSystem: 'systemd'
    })
    expect(formatRemoteOsLabel(info!)).toBe('Ubuntu 24.04.1 LTS (Linux, x86_64, init: systemd)')
  })

  it('parses Alpine Linux with OpenRC and ash', () => {
    const stdout = [
      'Linux 6.6.32-0-virt aarch64',
      '@@@',
      'NAME="Alpine Linux"\nVERSION_ID=3.20.2\nPRETTY_NAME="Alpine Linux v3.20"',
      '@@@',
      '/bin/ash',
      '@@@',
      'openrc'
    ].join('\n')

    const info = parseRemoteHostInfo(stdout)
    expect(info?.distro).toBe('Alpine Linux v3.20')
    expect(info?.shell).toBe('/bin/ash')
    expect(info?.initSystem).toBe('openrc')
    expect(formatRemoteOsLabel(info!)).toBe('Alpine Linux v3.20 (aarch64, init: openrc)')
  })

  it('parses macOS Darwin with launchd', () => {
    const stdout = [
      'Darwin 24.1.0 arm64',
      '@@@',
      'Darwin Kernel Version 24.1.0',
      '@@@',
      '/bin/zsh',
      '@@@',
      'launchd'
    ].join('\n')

    const info = parseRemoteHostInfo(stdout)
    expect(info).toEqual({
      os: 'Darwin',
      kernel: '24.1.0',
      arch: 'arm64',
      shell: '/bin/zsh',
      initSystem: 'launchd'
    })
  })

  it('returns null on empty output', () => {
    expect(parseRemoteHostInfo('')).toBeNull()
    expect(parseRemoteHostInfo('@@@\n@@@\n@@@')).toBeNull()
  })
})
