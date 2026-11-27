// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { INVOKE_CHANNELS, type Site } from '@shared/contract'
import { useSitesStore } from '../../../stores/sites.store'

const invokeMock = vi.fn()
const notifyMock = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn()
}

vi.mock('../../../api', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}))

vi.mock('../../../composables/useNotify', () => ({
  useNotify: () => notifyMock
}))

vi.mock('@nuxt/ui/components/Checkbox.vue', () => ({
  default: {
    name: 'UCheckbox',
    props: ['modelValue', 'ariaLabel'],
    emits: ['update:modelValue'],
    template:
      '<input type="checkbox" :checked="modelValue" :aria-label="ariaLabel" @change="$emit(\'update:modelValue\', $event.target.checked)" />'
  }
}))

import ExportSshConfigDialog from '../ExportSshConfigDialog.vue'

const sampleSites: Site[] = [
  {
    id: 's1',
    name: 'Prod Web',
    host: '10.0.1.10',
    port: 22,
    username: 'deploy',
    authMethod: 'privateKey',
    privateKeyPath: '/home/me/.ssh/id_ed25519',
    hasPassword: false,
    hasPassphrase: false,
    createdAt: '',
    updatedAt: ''
  },
  {
    id: 's2',
    name: 'Staging DB',
    host: 'db.staging.internal',
    port: 2222,
    username: 'postgres',
    authMethod: 'agent',
    hasPassword: false,
    hasPassphrase: false,
    createdAt: '',
    updatedAt: ''
  }
]

const stubs = {
  UModal: {
    props: ['open', 'title', 'description'],
    template: '<div v-if="open"><slot name="body" /><slot name="footer" /></div>'
  },
  UAlert: {
    props: ['title', 'description'],
    template: '<div role="alert">{{ title }} {{ description }}</div>'
  },
  UBadge: { template: '<span><slot /></span>' },
  UCheckbox: {
    props: ['modelValue', 'ariaLabel'],
    emits: ['update:modelValue'],
    template:
      '<input type="checkbox" :checked="modelValue" :aria-label="ariaLabel" @change="$emit(\'update:modelValue\', $event.target.checked)" />'
  },
  UButton: {
    props: ['label', 'disabled', 'loading'],
    template: '<button :disabled="disabled"><slot>{{ label }}</slot></button>'
  }
}

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(ExportSshConfigDialog, {
    props: { open: true, ...props },
    global: { stubs }
  })
}

describe('ExportSshConfigDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const store = useSitesStore()
    store.sites = [...sampleSites]
    delete (window as { NL_ARGS?: unknown }).NL_ARGS
  })

  it('selects all sites by default and previews exported OpenSSH config via IPC', async () => {
    invokeMock.mockResolvedValueOnce({
      content: '# Exported from Ferry\n\nHost Prod-Web\n  HostName 10.0.1.10\n',
      exportedCount: 2,
      skippedCount: 0
    })

    const w = mountDialog()
    await flushPromises()

    expect(invokeMock).toHaveBeenCalledWith(INVOKE_CHANNELS.sitesExportSshConfig, {
      siteIds: ['s1', 's2'],
      includeHeader: true
    })
    expect(w.get('[data-testid="ssh-config-preview"]').text()).toContain('Host Prod-Web')
    expect(w.text()).toContain('2 of 2 sites selected')
  })

  it('pre-selects only initialSiteIds when opened from bulk selection', async () => {
    invokeMock.mockResolvedValueOnce({
      content: 'Host Staging-DB\n  HostName db.staging.internal\n  Port 2222\n',
      exportedCount: 1,
      skippedCount: 0
    })

    const w = mountDialog({ initialSiteIds: ['s2'] })
    await flushPromises()

    expect(invokeMock).toHaveBeenCalledWith(INVOKE_CHANNELS.sitesExportSshConfig, {
      siteIds: ['s2'],
      includeHeader: true
    })
    expect(w.text()).toContain('1 of 2 sites selected')
  })

  it('updates preview when toggling site checkboxes and disables actions when none selected', async () => {
    invokeMock.mockResolvedValueOnce({
      content: 'Host Prod-Web\n  HostName 10.0.1.10\n',
      exportedCount: 1,
      skippedCount: 0
    })

    const w = mountDialog({ initialSiteIds: ['s1'] })
    await flushPromises()

    const checkbox = w.get('input[aria-label="Select Prod Web"]')
    await checkbox.setValue(false)
    await flushPromises()

    expect(w.text()).toContain('0 of 2 sites selected')
    const copyBtn = w.findAll('button').find((b) => b.text().trim() === 'Copy')!
    expect(copyBtn.attributes('disabled')).toBeDefined()
  })

  it('copies the generated OpenSSH config to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    })

    const content = '# Exported from Ferry\n\nHost Prod-Web\n  HostName 10.0.1.10\n'
    invokeMock.mockResolvedValueOnce({ content, exportedCount: 1, skippedCount: 0 })

    const w = mountDialog({ initialSiteIds: ['s1'] })
    await flushPromises()

    const copyBtn = w.findAll('button').find((b) => b.text().trim() === 'Copy')!
    await copyBtn.trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith(content)
    expect(notifyMock.success).toHaveBeenCalledWith('OpenSSH config copied', '1 site copied to clipboard')
  })

  it('saves via native dialogPickSaveFile + fsLocalWriteFile in desktop mode', async () => {
    ;(window as { NL_ARGS?: unknown }).NL_ARGS = ['ferry']
    const content = 'Host Prod-Web\n  HostName 10.0.1.10\n'
    invokeMock
      .mockResolvedValueOnce({ content, exportedCount: 1, skippedCount: 0 })
      .mockResolvedValueOnce('/home/me/.ssh/config')
      .mockResolvedValueOnce(undefined)

    const w = mountDialog({ initialSiteIds: ['s1'] })
    await flushPromises()

    const saveBtn = w.findAll('button').find((b) => b.text().includes('Save config'))!
    await saveBtn.trigger('click')
    await flushPromises()

    expect(invokeMock).toHaveBeenNthCalledWith(2, INVOKE_CHANNELS.dialogPickSaveFile, 'config')
    expect(invokeMock).toHaveBeenNthCalledWith(3, INVOKE_CHANNELS.fsLocalWriteFile, {
      path: '/home/me/.ssh/config',
      content
    })
    expect(notifyMock.success).toHaveBeenCalledWith('OpenSSH config saved', 'Saved to /home/me/.ssh/config')
  })
})
