// @vitest-environment happy-dom
import { computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { FileEntry } from '@shared/contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '../../../stores/ui.store'
import FileList from '../FileList.vue'
import FileRow from '../FileRow.vue'

vi.mock('@nuxt/ui/components/ContextMenu.vue', () => ({
  default: {
    name: 'ContextMenu',
    props: ['items', 'content'],
    template: '<div><slot /></div>'
  }
}))

// FileRow's toast notifications are unrelated to memo invalidation and rely on Nuxt auto-imports.
vi.mock('../../../composables/useNotify', () => ({
  useNotify: () => ({
    success: vi.fn(),
    error: vi.fn(),
    prompt: vi.fn()
  })
}))

vi.mock('@tanstack/vue-virtual', () => ({
  useVirtualizer: (opts: { value: { count: number; getItemKey: (i: number) => string | number } }) =>
    computed(() => ({
      getVirtualItems: () =>
        Array.from({ length: opts.value.count }, (_, index) => ({
          index,
          key: opts.value.getItemKey(index),
          start: index * 34
        })),
      getTotalSize: () => opts.value.count * 34,
      measureElement: () => {}
    }))
}))

const stubs = {
  UButton: { template: '<button><slot /></button>' },
  UDropdownMenu: { template: '<div><slot /></div>' },
  UIcon: true,
  UProgress: true,
  USkeleton: true,
  UBadge: { template: '<span><slot /></span>' },
  UInput: { template: '<input />' },
  UTooltip: { template: '<div><slot /></div>' }
}

const sampleEntries: FileEntry[] = [
  {
    name: 'config.yml',
    path: '/etc/config.yml',
    isDir: false,
    size: 2048,
    modifiedAt: '2026-11-20T10:00:00.000Z',
    permissions: '0644',
    isSymlink: false
  }
]

let wrapper: VueWrapper | null = null

describe('FileList v-memo UI preferences', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  function mountFileList(): VueWrapper {
    return mount(FileList, {
      props: {
        entries: sampleEntries,
        directoryPath: '/etc',
        selected: new Set<string>(),
        side: 'remote',
        active: true,
        sortColumn: 'name',
        sortDirection: 'asc'
      },
      global: { stubs }
    })
  }

  it('re-renders FileRow when column visibility or permissionsDisplay changes', async () => {
    const ui = useUiStore()
    wrapper = mountFileList()
    await flushPromises()

    const row = wrapper.findComponent(FileRow)
    expect(row.exists()).toBe(true)
    expect(row.findAll('[role="gridcell"]').length).toBeGreaterThanOrEqual(4)
    expect(row.text()).toContain('2.0 KB')

    ui.setColumnVisible('size', false)
    await flushPromises()
    expect(wrapper.findComponent(FileRow).text()).not.toContain('2.0 KB')

    const initialPermText = wrapper.findComponent(FileRow).find('button[type="button"]').text()
    ui.togglePermissionsDisplay()
    await flushPromises()
    const updatedPermText = wrapper.findComponent(FileRow).find('button[type="button"]').text()
    expect(updatedPermText).not.toBe(initialPermText)
  })

  it('re-renders FileRow when density or glassUiEnabled changes', async () => {
    const ui = useUiStore()
    wrapper = mountFileList()
    await flushPromises()

    expect(wrapper.findComponent(FileRow).classes()).toContain('py-1.5')
    ui.setDensity('compact')
    await flushPromises()
    expect(wrapper.findComponent(FileRow).classes()).toContain('py-0.5')

    expect(wrapper.findComponent(FileRow).classes()).toContain('hover:bg-elevated/60')
    ui.setGlassUiEnabled(true)
    await flushPromises()
    expect(wrapper.findComponent(FileRow).classes()).toContain('hover:bg-muted/50')
  })
})
