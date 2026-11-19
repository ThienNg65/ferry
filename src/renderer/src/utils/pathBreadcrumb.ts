export interface BreadcrumbSegment {
  label: string
  fullPath: string
}

export interface CollapsedBreadcrumbs {
  root: BreadcrumbSegment | null
  collapsed: BreadcrumbSegment[]
  current: BreadcrumbSegment | null
}

/**
 * Collapses intermediate ancestor segments into a dropdown list while keeping
 * root (`/` or `C:\`) and the active directory always visible.
 */
export function collapseBreadcrumbSegments(segments: BreadcrumbSegment[]): CollapsedBreadcrumbs {
  if (segments.length <= 2) {
    return {
      root: segments[0] ?? null,
      collapsed: [],
      current: segments[1] ?? null
    }
  }
  return {
    root: segments[0],
    collapsed: segments.slice(1, -1),
    current: segments[segments.length - 1]
  }
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
    if (normalized.startsWith('\\\\')) {
      const rootLabel = parts.length >= 2 ? `\\\\${parts[0]}\\${parts[1]}` : `\\\\${parts[0]}`
      const segments: BreadcrumbSegment[] = [{ label: rootLabel, fullPath: rootLabel }]
      let current = rootLabel
      for (let i = 2; i < parts.length; i++) {
        current = `${current}\\${parts[i]}`
        segments.push({ label: parts[i], fullPath: current })
      }
      return segments
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
  const isAbs = path.startsWith('/')
  let current = ''
  if (isAbs) {
    segments.push({ label: '/', fullPath: '/' })
  }
  for (const part of parts) {
    current = isAbs || current !== '' ? `${current}/${part}` : part
    segments.push({ label: part, fullPath: current })
  }
  return segments
}
