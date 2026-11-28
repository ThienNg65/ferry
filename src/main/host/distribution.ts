import { existsSync } from 'node:fs'
import path from 'node:path'

/** True when the app is distributed through a store that owns updates (MSIX or Mac App Store). */
export function isStoreManaged(): boolean {
  return (
    process.env['FERRY_STORE_BUILD'] === '1' ||
    process.env['FERRY_DISTRIBUTION'] === 'mas' ||
    isWindowsStoreInstall() ||
    isMacAppStoreInstall()
  )
}

function isWindowsStoreInstall(): boolean {
  return process.platform === 'win32' && /[\\/]WindowsApps[\\/]/i.test(process.execPath)
}

/** Mac App Store builds carry `Contents/_MASReceipt/receipt` inside the .app bundle. */
function isMacAppStoreInstall(): boolean {
  if (process.platform !== 'darwin') return false
  const marker = `${path.sep}Contents${path.sep}`
  const idx = process.execPath.indexOf(marker)
  if (idx === -1) return false
  const contents = process.execPath.slice(0, idx + marker.length)
  return existsSync(path.join(contents, '_MASReceipt', 'receipt'))
}

/** Human-readable store name for status messages. */
export function storeName(): string {
  return process.platform === 'darwin' ? 'the Mac App Store' : 'the Microsoft Store'
}
