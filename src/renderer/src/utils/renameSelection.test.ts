import { describe, expect, it } from 'vitest'
import { renameSelectionEnd } from './renameSelection'

describe('renameSelectionEnd', () => {
  it('stops before the extension for files', () => {
    expect(renameSelectionEnd('report.final.pdf', false)).toBe(12)
  })
  it('selects everything for dotfiles, extensionless files and folders', () => {
    expect(renameSelectionEnd('.bashrc', false)).toBe(7)
    expect(renameSelectionEnd('Makefile', false)).toBe(8)
    expect(renameSelectionEnd('v1.2', true)).toBe(4)
  })
})
