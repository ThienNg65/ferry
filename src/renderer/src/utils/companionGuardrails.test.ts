import { describe, expect, it } from 'vitest'
import {
  evaluateSyncPreFlight,
  evaluateTransferPreFlight,
  isSensitiveSecretFilename
} from './companionGuardrails'

describe('companionGuardrails', () => {
  it('flags sensitive secret files while allowing safe public/template files', () => {
    expect(isSensitiveSecretFilename('.env')).toBe(true)
    expect(isSensitiveSecretFilename('/app/.env.production')).toBe(true)
    expect(isSensitiveSecretFilename('id_rsa')).toBe(true)
    expect(isSensitiveSecretFilename('id_ed25519')).toBe(true)
    expect(isSensitiveSecretFilename('sample_id_ed25519')).toBe(true)
    expect(isSensitiveSecretFilename('deploy_id_rsa')).toBe(true)
    expect(isSensitiveSecretFilename('prod-id_ecdsa')).toBe(true)
    expect(isSensitiveSecretFilename('legacy_id_dsa')).toBe(true)
    expect(isSensitiveSecretFilename('deploy.ppk')).toBe(true)
    expect(isSensitiveSecretFilename('office-vpn.ovpn')).toBe(true)
    expect(isSensitiveSecretFilename('app_secrets.yaml')).toBe(true)
    expect(isSensitiveSecretFilename('server.pem')).toBe(true)
    expect(isSensitiveSecretFilename('credentials.json')).toBe(true)
    expect(isSensitiveSecretFilename('.npmrc')).toBe(true)

    expect(isSensitiveSecretFilename('.env.example')).toBe(false)
    expect(isSensitiveSecretFilename('.env.sample')).toBe(false)
    expect(isSensitiveSecretFilename('id_ed25519.pub')).toBe(false)
    expect(isSensitiveSecretFilename('sample_id_ed25519.pub')).toBe(false)
    expect(isSensitiveSecretFilename('README.md')).toBe(false)
  })

  it('warns on sensitive uploads and low remote disk space, but not downloads', () => {
    const res = evaluateTransferPreFlight(
      [
        { direction: 'upload', targetName: '.env.production', sourceSize: 512 },
        { direction: 'upload', targetName: 'bundle.tar.gz', sourceSize: 500 * 1024 * 1024 }
      ],
      { totalBytes: 1000 * 1024 * 1024, usedBytes: 960 * 1024 * 1024, availableBytes: 40 * 1024 * 1024 }
    )
    expect(res.sensitiveFiles).toEqual(['.env.production'])
    expect(res.lowDiskWarning).toContain('Upload requires')
    expect(res.warnings.length).toBe(2)

    const downloadOnly = evaluateTransferPreFlight(
      [{ direction: 'download', targetName: '.env', sourceSize: 128 }],
      { totalBytes: 100, usedBytes: 98, availableBytes: 2 }
    )
    expect(downloadOnly.warnings).toEqual([])
  })

  it('evaluates risky folder sync deletions, sensitive pushes, and full remote disk', () => {
    const syncCheck = evaluateSyncPreFlight(
      {
        toTransfer: [{ relPath: 'config/.env' }, { relPath: 'index.html' }],
        toDelete: ['old-release/app.js'],
        totalBytes: 1024
      },
      { direction: 'push', deleteExtras: true },
      { totalBytes: 10_000, usedBytes: 9_600, availableBytes: 400 }
    )
    expect(syncCheck.hasDestructiveDeletes).toBe(true)
    expect(syncCheck.sensitiveFiles).toEqual(['config/.env'])
    expect(syncCheck.lowDiskWarning).toContain('Upload requires')
    expect(syncCheck.warnings.length).toBe(3)
  })

  it('catches nested secrets inside uploaded folders and reports mountPoint/inode exhaustion', () => {
    const res = evaluateTransferPreFlight(
      [{ direction: 'upload', targetName: 'deploy-bundle', sourceSize: 0, isDir: true }],
      {
        totalBytes: 100 * 1024 * 1024,
        usedBytes: 50 * 1024 * 1024,
        availableBytes: 50 * 1024 * 1024,
        mountPoint: '/var',
        inodesTotal: 10_000,
        inodesUsed: 9_600,
        inodesAvailable: 400
      },
      { relativePaths: ['deploy-bundle/config/.env', 'deploy-bundle/app.js'], totalBytes: 2048 }
    )
    expect(res.sensitiveFiles).toEqual(['deploy-bundle/config/.env'])
    expect(res.lowDiskWarning).toContain('/var')
    expect(res.lowDiskWarning).toContain('inode usage is 96%')
  })
})
