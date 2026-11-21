// @vitest-environment happy-dom
import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { computed } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { FileEntry } from '@shared/contract'
import FileList from '@renderer/components/files/FileList.vue'

vi.mock('@tanstack/vue-virtual', () => ({
  useVirtualizer: (options: { value: { count: number; getItemKey: (index: number) => string } }) =>
    computed(() => ({
      getVirtualItems: () => [5, 6].filter((index) => index < options.value.count)
        .map((index) => ({ index, key: options.value.getItemKey(index), start: index * 34 })),
      getTotalSize: () => options.value.count * 34,
      measureElement: () => {}
    }))
}))

vi.mock('@renderer/composables/useNotify', () => ({ useNotify: () => ({}) }))
vi.mock('@nuxt/ui/components/ContextMenu.vue', () => ({
  default: { template: '<div><slot /></div>' }
}))

const entries: FileEntry[] = Array.from({ length: 12 }, (_, index) => ({
  name: `file-${index}.txt`,
  path: `/files/file-${index}.txt`,
  isDir: false,
  size: 0,
  modifiedAt: 0,
  permissions: '-rw-r--r--'
}))

function mountGrid(props: { side?: 'local' | 'remote'; entries?: FileEntry[]; loading?: boolean; searchFiltered?: boolean } = {}) {
  return mount(FileList, {
    props: {
      entries,
      directoryPath: '/files',
      selected: new Set([entries[5].path]),
      side: 'local',
      active: true,
      sortColumn: 'name',
      sortDirection: 'asc',
      ...props
    },
    global: {
      plugins: [createPinia()],
      stubs: {
        UDropdownMenu: { template: '<div><slot /></div>' },
        UTooltip: { template: '<div><slot /></div>' },
        UButton: { template: '<button><slot /></button>' },
        UBadge: true,
        UIcon: true,
        UInput: true,
        UProgress: true,
        USkeleton: true
      }
    }
  })
}

describe('virtual file grid accessibility', () => {
  it.each(['local', 'remote'] as const)('owns the sortable headers and virtualized cells in the %s grid', (side) => {
    const list = mountGrid({ side })
    const grid = list.get('[role="grid"]')
    const header = grid.get('[role="row"][aria-rowindex="1"]')
    const rows = grid.get('[role="rowgroup"]').findAll('[role="row"]')
    const columnCount = side === 'remote' ? 5 : 4

    expect(grid.attributes('aria-label')).toBe(`${side} files`)
    expect(grid.attributes('aria-rowcount')).toBe('13')
    expect(grid.attributes('aria-multiselectable')).toBe('true')
    expect(header.findAll('[role="columnheader"]')).toHaveLength(columnCount)
    expect(header.get('[aria-sort="ascending"] button').text()).toBe('Name')
    expect(rows.map((row) => row.attributes('aria-rowindex'))).toEqual(['7', '8'])
    expect(rows[0].attributes('aria-selected')).toBe('true')
    expect(rows[0].findAll('[role="gridcell"]')).toHaveLength(columnCount)
    list.unmount()
  })

  it('updates row positions and sort state without losing selection when the entries reorder', async () => {
    const list = mountGrid()
    const selected = () => list.get('[role="row"][aria-selected="true"]')

    expect(selected().attributes('aria-rowindex')).toBe('7')
    await list.setProps({ entries: [...entries].reverse(), sortDirection: 'desc' })
    expect(list.get('[aria-sort="descending"]').text()).toBe('Name')
    expect(selected().attributes('aria-rowindex')).toBe('8')
    expect(selected().attributes('data-row-path')).toBe(entries[5].path)
    list.unmount()
  })

  it('keeps native header activation isolated from the pane Enter shortcut', async () => {
    const parent = document.createElement('div')
    document.body.append(parent)
    const handlePaneKey = vi.fn()
    parent.addEventListener('keydown', handlePaneKey)
    const list = mountGrid()
    parent.append(list.element)
    const sortButton = list.get('[aria-sort="ascending"] button')

    await sortButton.trigger('keydown', { key: 'Enter' })
    expect(handlePaneKey).not.toHaveBeenCalled()
    await sortButton.trigger('click')
    expect(list.emitted('sort')).toEqual([['name']])
    await sortButton.trigger('keydown', { key: 'ArrowDown' })
    expect(handlePaneKey).toHaveBeenCalledOnce()
    list.unmount()
    parent.remove()
  })

  it('keeps loading feedback and search controls outside the grid', async () => {
    const list = mountGrid({ entries: [], loading: true, searchFiltered: true })
    const grid = list.get('[role="grid"]')

    expect(grid.attributes('aria-busy')).toBe('true')
    expect(grid.attributes('aria-rowcount')).toBe('1')
    expect(grid.find('[role="status"]').exists()).toBe(false)
    expect(list.get('[role="status"]').attributes('aria-label')).toBe('Loading directory')
    await list.setProps({ loading: false })
    const clear = list.findAll('button').find((button) => button.text() === 'Clear search')
    expect(clear?.element.closest('[role="grid"]')).toBeNull()
    await clear?.trigger('click')
    expect(list.emitted('clear-filter')).toHaveLength(1)
    list.unmount()
  })
})
