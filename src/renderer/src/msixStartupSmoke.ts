import { INVOKE_CHANNELS } from '@shared/contract'
import { invoke } from './api'

export async function reportMsixStartup(): Promise<void> {
  const sites = await invoke<unknown>(INVOKE_CHANNELS.sitesList).catch(() => null)
  // Only report the outcome in the native window title. Site data stays in the renderer.
  const status = Array.isArray(sites) ? 'ready' : 'failed'
  await invoke<void>(INVOKE_CHANNELS.windowSetTitle, `Ferry MSIX smoke: sites ${status}`)
}
