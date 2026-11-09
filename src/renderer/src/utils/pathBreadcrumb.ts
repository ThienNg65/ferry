export interface BreadcrumbSegment {
  label: string
  fullPath: string
}

/**
 * Splits a POSIX (`/var/log/nginx`) or Windows (`C:\Users\name`) directory path
 * into clickable ancestor segments for `PathBreadcrumb.vue`.
 */
export function parseBreadcrumbSegments(rawPath: string): BreadcrumbSegment[] {
  const path = rawPath.trim()
  if (!path || path === '/') {
    return [{ label: '/', fullPath: '/' }]
  }

  const isWindows = /^[a-zA-Z]:/.test(path) || path.includes('\\')
  if (isWindows) {
    const normalized = path.replace(/\//g, '\\').replace(/\\+$/, '')
    const parts = normalized.split('\\').filter(Boolean)
    if (parts.length === 0) {
      return [{ label: path, fullPath: path }]
    }
    const drive = parts[0].endsWith(':') ? `${parts[0]}\\` : parts[0]
    const segments: BreadcrumbSegment[] = [{ label: drive, fullPath: drive }]
    let current = drive.replace(/\\$/, '')
    for (let i = 1; i < parts.length; i++) {
      current = `${current}\\${parts[i]}`
      segments.push({ label: parts[i], fullPath: current })
    }
    return segments
  }

  const trimmed = path.replace(/\/+$/, '')
  if (!trimmed) {
    return [{ label: '/', fullPath: '/' }]
  }
  const parts = trimmed.split('/').filter(Boolean)
  const segments: BreadcrumbSegment[] = []
  let current = ''
  if (path.startsWith('/')) {
    segments.push({ label: '/', fullPath: '/' })
  }
  for (const part of parts) {
    current = `${current}/${part}`
    segments.push({ label: part, fullPath: current })
  }
  return segments
}
