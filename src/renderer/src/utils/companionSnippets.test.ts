import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_SNIPPETS,
  classifyCommandRisk,
  diagnoseLogSnippetOffline,
  diagnoseMonitorSpikeOffline,
  translatePlainEnglishCommandOffline
} from './companionSnippets'

describe('companionSnippets', () => {
  it('classifies read_only, mutating, and destructive commands deterministically', () => {
    expect(classifyCommandRisk('df -h')).toBe('read_only')
    expect(classifyCommandRisk('ss -tulpn')).toBe('read_only')
    expect(classifyCommandRisk('systemctl restart nginx')).toBe('mutating')
    expect(classifyCommandRisk('chmod 644 config.yml')).toBe('mutating')
    expect(classifyCommandRisk('rm -rf /var/www/app')).toBe('destructive')
    expect(classifyCommandRisk('kill -9 1234')).toBe('destructive')
  })

  it('ships built-in read-only DevOps snippets', () => {
    expect(BUILT_IN_SNIPPETS.length).toBeGreaterThanOrEqual(5)
    expect(BUILT_IN_SNIPPETS.every((s) => s.builtIn && s.risk === 'read_only')).toBe(true)
  })

  it('translates plain-English requests into risk-badged Command Cards offline', () => {
    const disk = translatePlainEnglishCommandOffline('Command to check disk usage')
    expect(disk?.commandCards.some((c) => c.command === 'df -h' && c.risk === 'read_only')).toBe(true)

    const ports = translatePlainEnglishCommandOffline('How do I list listening ports?')
    expect(ports?.commandCards.some((c) => c.command.includes('ss -tulpn'))).toBe(true)

    expect(translatePlainEnglishCommandOffline('Tell me a bedtime story')).toBeNull()
  })

  it('diagnoses common log errors and monitor spikes offline', () => {
    const logDiag = diagnoseLogSnippetOffline('/var/log/nginx/error.log', 'write() failed (28: No space left on device)')
    expect(logDiag.rootCause).toContain('disk space')
    expect(logDiag.commandCards?.some((c) => c.command.includes('df -h'))).toBe(true)
    expect(logDiag.uiActionCards?.some((a) => a.kind === 'tail-log')).toBe(true)

    const spikeDiag = diagnoseMonitorSpikeOffline({
      cpuPct: 94.2,
      memPct: 89,
      swapPct: 60,
      diskPct: 96,
      loadAvg: [6.5, 4.2, 3.1],
      coreCount: 4,
      topProcesses: [{ pid: 4321, name: 'node', cpuPct: 88.5, rssMB: 1024 }]
    })
    expect(spikeDiag.summary).toContain('high CPU')
    expect(spikeDiag.summary).toContain('node')
    expect(spikeDiag.commandCards?.some((c) => c.command.includes('ps -p 4321'))).toBe(true)
  })
})
