import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const fileList = readFileSync(fileURLToPath(new URL('../src/renderer/src/components/files/FileList.vue', import.meta.url)), 'utf8')
const fileRow = readFileSync(fileURLToPath(new URL('../src/renderer/src/components/files/FileRow.vue', import.meta.url)), 'utf8')

describe('virtual file grid accessibility contract', () => {
  it('owns the header and virtualized rows within one grid', () => {
    expect(fileList).toMatch(/role="grid"[\s\S]*:aria-rowcount="entries\.length \+ 1"/)
    expect(fileList).toMatch(/role="row"[\s\S]*aria-rowindex="1"/)
    expect(fileList).toContain('ref="scrollEl" role="rowgroup"')
    expect(fileList).not.toContain('ref="scrollEl" role="grid"')
  })

  it('exposes one-based positions including the header for virtual rows', () => {
    expect(fileList).toContain(':row-index="virtualRow.index + 2"')
    expect(fileRow).toContain(':aria-rowindex="rowIndex"')
    expect(fileRow).toContain(':aria-selected="selected"')
  })

  it('keeps the sort announcement and row memoization updated', () => {
    expect(fileList).toContain(':aria-sort="ariaSort(\'name\')"')
    expect(fileList).toContain('virtualRow.index,')
  })
})
