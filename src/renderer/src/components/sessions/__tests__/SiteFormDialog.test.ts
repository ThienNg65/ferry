// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { Site, SiteInput } from '@shared/contract'
import SiteFormDialog from '../SiteFormDialog.vue'

const createSite = vi.fn()
const updateSite = vi.fn()

vi.mock('../../../stores/sites.store', () => ({ useSitesStore: () => ({ createSite, updateSite, groupNames: [] }) }))
vi.mock('../../../api', () => ({ invoke: vi.fn() }))
vi.mock('../../../composables/useConfirm', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }))
vi.mock('../../../composables/useNotify', () => ({ useNotify: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('@nuxt/ui/components/Switch.vue', () => ({ default: { template: '<span />' } }))
vi.mock('@nuxt/ui/components/Collapsible.vue', () => ({ default: { template: '<div><slot /></div>' } }))

type FormVm = {
  form: Record<string, unknown>
  environment: string
  proxyMode: string
  proxyHost: string
  proxyUsername: string
  proxyPassword: string
  useJumpHost: boolean
  jumpHops: Array<Record<string, unknown>>
  save: (andConnect?: boolean) => Promise<void>
}

function mountDialog(props: Record<string, unknown> = {}) {
  const wrapper = mount(SiteFormDialog, {
    props: { open: true, ...props },
    global: {
      stubs: {
        UModal: { template: '<div><slot /><slot name="body" /><slot name="footer" :close="() => undefined" /></div>' },
        UIcon: true,
        UButton: true,
        UInput: true,
        UFormField: true,
        USelect: true,
        UTooltip: true,
        JumpHostHopEditor: true,
        GenerateKeyDialog: true,
        PasswordInput: true
      }
    }
  })
  return { wrapper, vm: wrapper.vm as unknown as FormVm }
}

describe('SiteFormDialog save mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createSite.mockResolvedValue({ id: 'new' } as Site)
    updateSite.mockResolvedValue({ id: 'existing' } as Site)
  })

  it('trims fields, drops empty optionals and maps a password site to SiteInput', async () => {
    const { vm } = mountDialog()
    Object.assign(vm.form, {
      name: '  Prod  ', host: ' h.example.com ', username: ' root ', port: 2222,
      password: 'pw', privateKeyPath: '/ignored', agentPath: '/ignored', remoteInitialPath: '  ', group: ' web '
    })
    await vm.save()
    await flushPromises()
    const input = createSite.mock.calls[0][0] as SiteInput
    expect(input).toMatchObject({
      name: 'Prod', host: 'h.example.com', username: 'root', port: 2222, authMethod: 'password',
      password: 'pw', group: 'web', proxyMode: 'inherit'
    })
    expect(input.privateKeyPath).toBeUndefined()
    expect(input.agentPath).toBeUndefined()
    expect(input.remoteInitialPath).toBeUndefined()
    expect(input.jumpHosts).toBeUndefined()
    expect(input.proxy).toBeUndefined()
    expect(input.environment).toBeUndefined()
  })

  it('keeps the key path only for private-key auth and the agent path only for agent auth', async () => {
    const { vm } = mountDialog()
    Object.assign(vm.form, { name: 'k', host: 'h', username: 'u', authMethod: 'privateKey', privateKeyPath: ' /k ', agentPath: '/a' })
    await vm.save()
    await flushPromises()
    expect(createSite.mock.calls[0][0]).toMatchObject({ privateKeyPath: '/k', agentPath: undefined })
  })

  it('maps a custom proxy and an environment tag', async () => {
    const { vm } = mountDialog()
    Object.assign(vm.form, { name: 'p', host: 'h', username: 'u' })
    vm.proxyMode = 'custom'
    vm.proxyHost = ' proxy.local '
    vm.proxyUsername = ''
    vm.proxyPassword = 'secret'
    vm.environment = 'prod'
    await vm.save()
    await flushPromises()
    const input = createSite.mock.calls[0][0] as SiteInput
    expect(input.proxyMode).toBe('custom')
    expect(input.proxy).toMatchObject({ type: 'socks5', host: 'proxy.local', port: 1080, username: undefined, password: 'secret' })
    expect(input.environment).toBe('prod')
  })

  it('maps jump hops, keeping each hop source index and omitting blank secrets', async () => {
    const { vm } = mountDialog()
    Object.assign(vm.form, { name: 'j', host: 'h', username: 'u' })
    vm.useJumpHost = true
    vm.jumpHops = [{
      id: 'a', sourceIndex: 0, host: ' bastion ', port: 22, username: ' b ', authMethod: 'password',
      privateKeyPath: '', password: '', passphrase: ''
    }, {
      id: 'b', sourceIndex: undefined, host: 'second', port: '2200', username: 'c', authMethod: 'privateKey',
      privateKeyPath: ' /key ', password: '', passphrase: 'pp'
    }]
    await vm.save()
    await flushPromises()
    expect((createSite.mock.calls[0][0] as SiteInput).jumpHosts).toEqual([
      { host: 'bastion', port: 22, username: 'b', authMethod: 'password', privateKeyPath: undefined, password: undefined, passphrase: undefined, sourceIndex: 0 },
      { host: 'second', port: 2200, username: 'c', authMethod: 'privateKey', privateKeyPath: '/key', password: undefined, passphrase: 'pp', sourceIndex: -1 }
    ])
  })

  it('updates an existing site instead of creating one and emits saved', async () => {
    const site = {
      id: 'existing', name: 'Old', host: 'old.example.com', port: 22, username: 'root', authMethod: 'password',
      hasPassword: true, hasPassphrase: false, createdAt: '', updatedAt: ''
    } as Site
    const { wrapper, vm } = mountDialog({ site })
    await vm.save(true)
    await flushPromises()
    expect(updateSite).toHaveBeenCalledWith('existing', expect.objectContaining({ name: 'Old', host: 'old.example.com' }))
    expect(createSite).not.toHaveBeenCalled()
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(wrapper.emitted('saved-and-connect')).toHaveLength(1)
  })

  it('does not save an invalid form', async () => {
    const { vm } = mountDialog()
    await vm.save()
    expect(createSite).not.toHaveBeenCalled()
  })
})
