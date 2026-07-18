import { spawnSync } from 'child_process'
import { describe, expect, it } from 'vitest'
import { buildExtractCommand } from './UnzipService'

/** Whether a POSIX shell is available to actually execute a built command against, for the injection tests below. */
function hasShell(): boolean {
  return spawnSync('sh', ['-c', 'true']).status === 0
}

describe('buildExtractCommand', () => {
  /**
   * Runs `command` through a real shell and asserts the `$(echo INJECTED)`
   * payload was never substituted/executed. Whether the built command reaches
   * the real `unzip`/`tar` invocation or short-circuits at the "tool missing"
   * sentinel depends on whether that tool happens to be installed on the
   * machine running this test — either way, the payload must survive as inert
   * literal text. If it was executed, the literal `$(echo INJECTED)` text
   * would be replaced by its bare output (`INJECTED`) before ever reaching
   * this point, so stripping the literal-safe form and checking nothing is
   * left catches an injection regardless of which branch actually ran.
   */
  function assertPayloadNotExecuted(command: string): void {
    const result = spawnSync('sh', ['-c', command], { encoding: 'utf8' })
    const output = (result.stdout + result.stderr).replaceAll('$(echo INJECTED)', '')
    expect(output).not.toContain('INJECTED')
  }

  it.runIf(hasShell())('is safe against an archive path containing a command-substitution payload', () => {
    assertPayloadNotExecuted(buildExtractCommand('zip', '/tmp/$(echo INJECTED)archive.zip', '/tmp/target'))
  })

  it.runIf(hasShell())('is safe against a target directory containing a double quote and a payload', () => {
    assertPayloadNotExecuted(buildExtractCommand('tar', '/tmp/archive.tar', '/tmp/"$(echo INJECTED)"target'))
  })
})
