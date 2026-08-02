import type { Site } from '@shared/contract'

/** Whether the Add Site dialog's advanced (jump host / proxy) section should start expanded — true only when the site being edited already has one of these configured, so existing settings are never hidden from view. */
export function shouldExpandAdvanced(
  site: Pick<Site, 'jumpHosts' | 'proxyMode'> | null | undefined
): boolean {
  if (!site) {
    return false
  }
  if (site.jumpHosts && site.jumpHosts.length > 0) {
    return true
  }
  return site.proxyMode === 'custom'
}
